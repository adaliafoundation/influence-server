# Hybrid Mode Local Setup

## Prerequisites

- Node.js 18+
- Docker
- A Starknet wallet (Argent X or Braavos) on **mainnet**
- A Starknet RPC endpoint (e.g. Alchemy) for mainnet

## 1. Start Dependencies

```bash
# MongoDB 6.0 with replica set (required for transactions)
docker run -d --name influence-mongo -p 27017:27017 mongo:6.0 --replSet rs0
# Wait for MongoDB to be ready, then init the replica set
sleep 3
docker exec influence-mongo mongosh --eval "rs.initiate({_id: 'rs0', members: [{_id: 0, host: 'localhost:27017'}]})"

# Redis
docker run -d --name influence-redis -p 6379:6379 redis:7-alpine
```

To stop/restart later:
```bash
docker stop influence-mongo influence-redis
docker start influence-mongo influence-redis
```

To remove completely:
```bash
docker rm -f influence-mongo influence-redis
```

## 2. Server Environment

Create `.env` in the server root (`influence-server/.env`):

```bash
MONGO_URL=mongodb://localhost:27017/influence?replicaSet=rs0
JWT_SECRET=<any-random-string>
API_SERVER=1
IMAGES_SERVER=0
GAME_MODE=hybrid
PORT=3001
CLIENT_URL=http://localhost:3000
BRIDGE_CLIENT_URL=http://localhost:3000
NODE_ENV=development
ETHEREUM_PROVIDER=http://localhost:8545
REDIS_URL=redis://localhost:6379
ELASTICSEARCH_URL=http://localhost:9200
STARKNET_RPC_PROVIDER=https://starknet-mainnet.g.alchemy.com/starknet/version/rpc/v0_7/YOUR_ALCHEMY_KEY
STARKNET_PROVIDER=https://starknet-mainnet.g.alchemy.com/starknet/version/rpc/v0_7/YOUR_ALCHEMY_KEY
```

### Environment variables explained

| Variable | Purpose |
|---|---|
| `MONGO_URL` | MongoDB connection string. Must include `replicaSet=rs0` for transaction support. |
| `JWT_SECRET` | Secret for signing auth tokens. Any random string works for local dev. |
| `API_SERVER` | Set to `1` to enable API routes. |
| `IMAGES_SERVER` | Set to `0` — we don't run the image rendering server locally. |
| `GAME_MODE` | Must be `hybrid` to enable local action execution and skip chain-only workers. |
| `PORT` | API server port. Default `3001`. |
| `CLIENT_URL` | Allowed CORS origin for the client. |
| `BRIDGE_CLIENT_URL` | Allowed CORS origin for the bridge client. |
| `NODE_ENV` | Must be `development` to load `config/development.json` (mainnet Starknet settings). |
| `ETHEREUM_PROVIDER` | Ethereum RPC URL. Not used in hybrid mode but required at startup. Any URL works. |
| `REDIS_URL` | Redis connection for Socket.IO adapter and auth challenge cache. |
| `ELASTICSEARCH_URL` | Elasticsearch URL. Not needed in hybrid mode (search endpoints fall back to MongoDB) but required at startup. Any URL works. |
| `STARKNET_RPC_PROVIDER` | Starknet mainnet RPC endpoint. Used by the fork tool to sync chain state. |
| `STARKNET_PROVIDER` | Starknet mainnet gateway/RPC. Fallback provider. |

### Server config file

The file `config/development.json` provides mainnet Starknet chain settings (chainId, contract
addresses) that are needed for auth and entity resolution. This file was created as part of the
hybrid mode setup — without it, `NODE_ENV=development` would fall back to `config/default.json`
which has no Starknet chain configuration.

## 3. Seed Test Data

```bash
# First time (uses wallet address from test/seed/data.json)
node test/seed/seed.js

# With a specific wallet address
node test/seed/seed.js --wallet 0xYOUR_STARKNET_ADDRESS

# Reset and re-seed
node test/seed/seed.js --reset --wallet 0xYOUR_STARKNET_ADDRESS
```

Edit the default wallet address in `test/seed/data.json` to avoid needing `--wallet` each time.

The seed creates: 2 asteroids, 1 crew with 3 crewmates, 2 buildings (warehouse + extractor),
NFT ownership records, a user record, and a WorldFork marker.

## 4. Start the Server

```bash
GAME_MODE=hybrid node src/api/server.js

# Or with auto-reload:
GAME_MODE=hybrid npm run watch
```

Verify: `curl http://localhost:3001/v2/health`

Expected response should show `"status":"ok"` with `gameMode.hybrid: true` and
`worldFork.status: "ok"`.

## 5. Client Environment

Create `.env.local` in the client root (`influence-client/.env.local`):

```bash
REACT_APP_GAMEMODE=hybrid
REACT_APP_STARKNET_CHAINID=0x534e5f4d41494e
REACT_APP_API_INFLUENCE=http://localhost:3001
```

### Client environment variables explained

| Variable | Purpose |
|---|---|
| `REACT_APP_GAMEMODE` | Activates hybrid code paths: local action execution, skipped on-chain approvals, mock wallet balances. |
| `REACT_APP_STARKNET_CHAINID` | Overrides the chain ID to mainnet (`0x534e5f4d41494e` = `SN_MAIN`). Without this, the client defaults to Sepolia from the prerelease config and rejects mainnet wallets. |
| `REACT_APP_API_INFLUENCE` | Points the API client at the local server. This overrides `Api.influence` in the client's appConfig (the key the axios instance uses as its `baseURL`). |

Note: `REACT_APP_API_URL` does **not** work — the client uses `Api.influence` as its config key,
which maps to the env var `REACT_APP_API_INFLUENCE`.

Then:
```bash
cd /path/to/influence-client
npm start
```

Open http://localhost:3000/

CRA only reads `.env` files at startup. If you change `.env.local`, restart the client.

## Troubleshooting

**ENOSPC file watcher error**: Increase the inotify limit:
```bash
sudo sysctl fs.inotify.max_user_watches=524288
# To persist across reboots:
echo 'fs.inotify.max_user_watches=524288' | sudo tee -a /etc/sysctl.conf
```

**MongoDB connection refused**: Check the container is running:
```bash
docker ps | grep influence-mongo
```

**"Incorrect chain, please switch to SN_SEPOLIA"**: The client `.env.local` is missing
`REACT_APP_STARKNET_CHAINID=0x534e5f4d41494e`, or you need to restart the client after
adding it.

**Signature verification failed**: This should not happen — in hybrid mode the server skips
on-chain signature verification. Make sure `GAME_MODE=hybrid` is set and the server was
restarted after the change.

**Login fails / no entities**: Re-run the seed script with your wallet address.

**Asteroid/crew images don't load**: Expected. Images are rendered by a separate image server
backed by S3/Cloudfront. Local seed entities don't have pre-rendered images. This is cosmetic
and doesn't affect functionality.

**`_search` endpoints return 500**: Should not happen — in hybrid mode the search endpoints
query MongoDB directly instead of Elasticsearch. If you see this error, make sure `GAME_MODE=hybrid`
is set and the server was restarted.
