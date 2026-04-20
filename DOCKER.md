# Docker Setup

Run the influence-server and all its dependencies (MongoDB, Redis, Elasticsearch) with a single command.

## Quick Start

```bash
docker compose up -d
```

This starts the API server in **hybrid mode** (no blockchain connection required) on port 3001.

Check that everything is running:

```bash
curl http://localhost:3001/v2/health
```

## Port Conflicts

If you already have MongoDB, Redis, or other services running locally, override the host ports:

```bash
MONGO_PORT=27018 PORT=3002 REDIS_PORT=6380 ES_PORT=9201 docker compose up -d
```

## Services

| Service | Description | Default Port |
|---------|-------------|--------------|
| `api` | Main API server | 3001 |
| `mongo` | MongoDB with replica set | 27017 |
| `redis` | Redis cache | 6379 |
| `elasticsearch` | Search indexing | 9200 |
| `elastic-indexer` | Worker that syncs MongoDB to Elasticsearch | - |
| `mongo-init` | One-shot container that initializes the replica set | - |
| `event-processor` | Blockchain event processor (chain mode only) | - |
| `client` | React dev server (optional, use `--profile client`) | 3000 |

## Environment Variables

Copy `.env.example` to `.env` to customize:

```bash
cp .env.example .env
```

Key variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `GAME_MODE` | `hybrid` | `hybrid` for local dev, `chain` for production |
| `JWT_SECRET` | `dev-secret-change-me` | Secret for signing auth tokens |
| `PORT` | `3001` | API server host port |
| `LOG_LEVEL` | `info` | `error`, `warn`, `info`, or `debug` |
| `MAX_ACTION_SECONDS` | (unset) | Cap all action durations to this many seconds |
| `TIME_ACCELERATION` | (unset) | Game-seconds per real-second (default 24) |

## Initializing the Game World

In hybrid mode, the server needs a world fork before game actions work.

**Empty world (no blockchain connection needed):**

```bash
docker compose exec api node src/workers/forkWorld.js --empty
```

This creates a blank world for local development.

**Load seed data (starter entities for testing):**

```bash
docker compose exec api node src/workers/loadSeedData.js
```

This populates the database with 2 asteroids, 2 crews, 5 crewmates, 10 buildings (warehouse, extractor, refinery, factory, shipyard, bioreactor, marketplace, habitat, spaceport, tank farm), 1 ship, inventories with resources, and a User record. All entities are owned by a default dev wallet. To use your own wallet:

```bash
docker compose exec api node src/workers/loadSeedData.js --wallet 0xYOUR_WALLET
```

The seed data also creates a WorldFork if one doesn't exist, so you can skip the `forkWorld.js --empty` step.

**Fork from live chain (requires Starknet RPC):**

Set `STARKNET_RPC_PROVIDER` in your `.env` to a real endpoint, then:

```bash
docker compose exec api node src/workers/forkWorld.js
```

This syncs all on-chain state up to the latest block.

**Verify the fork:**

```bash
curl http://localhost:3001/v2/health | jq .checks.worldFork
```

## Running the Client

To run the influence-client dev server alongside the API:

```bash
docker compose --profile client up -d
```

The first start builds a Docker image from the client repo (expected at `../influence-client`). This takes several minutes for `npm install` and the initial webpack compilation. Subsequent starts reuse the cached image and only recompile webpack (~2 minutes).

The client is automatically configured to connect to the API server. Open http://localhost:3000 once compilation finishes (check progress with `docker compose logs -f client`).

If your client repo is in a different location:

```bash
CLIENT_PATH=/path/to/influence-client docker compose --profile client up -d
```

After changing `package.json` in the client, rebuild the image:

```bash
docker compose --profile client build client
```

| Variable | Default | Description |
|----------|---------|-------------|
| `CLIENT_PATH` | `../influence-client` | Path to the client repo |
| `CLIENT_PORT` | `3000` | Client dev server host port |

## Chain Mode

To run with blockchain event processing (requires Starknet/Ethereum RPC endpoints):

```bash
GAME_MODE=chain docker compose --profile chain up -d
```

Set `STARKNET_PROVIDER`, `STARKNET_RPC_PROVIDER`, and `ETHEREUM_PROVIDER` in your `.env` file for chain mode.

## Common Commands

```bash
# View logs
docker compose logs -f api
docker compose logs -f client

# Rebuild after server code changes
docker compose build && docker compose up -d

# Rebuild after client code changes (package.json)
docker compose --profile client build client

# Stop everything (include --profile client if running the client)
docker compose --profile client down

# Stop and remove all data volumes
docker compose --profile client down -v

# Run a one-off command in the API container
docker compose exec api node <script>
```

## Troubleshooting

**MongoDB healthcheck failing**: The replica set initialization takes a few seconds. If dependent services fail on first start, wait and run `docker compose up -d` again.

**Redis connection timeout errors on startup**: Transient issue while Redis is still starting. The API will reconnect automatically.

**`Configuration property "X" is not defined`**: The `config/docker.json` file may be missing. Make sure it was not excluded by `.gitignore` or `.dockerignore`.
