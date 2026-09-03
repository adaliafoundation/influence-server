# Influence Server

API and events server for Influence. A grand strategy game set in an asteroid belt and built on Ethereum.

## License
This project is licensed under the Creative Commons Attribution-NonCommercial 4.0 International License (CC BY-NC 4.0).
Commercial use is not permitted without a separate license from Unstoppable Games, Inc.

For the avoidance of doubt:
The licensor considers non-commercial use under this license to include deployments or uses that collect funds solely to recover the reasonable costs of operating, maintaining, or administering the software, provided that such use is not primarily intended for or directed toward commercial advantage or monetary compensation, and that no profit is distributed to operators, contributors, or participants.

## Migration to Starknet
1. Run scripts in `./bin/starknet-setup` to migrate asteroids and crewmates to components from snapshots.
1. Manually retrieve and process events since the snapshot block time on L1.
1. Setup retriever for Starknet.
1. Re-process all events.

## Test Environment
1. Install local node modules: `npm install`
1. Ensure a local mongo instance is running.
1. (Optionally) ensure a local redis instance is running.
1. Initialize your .env file:
    ```
    echo "API_SERVER=1
    CLIENT_URL=http://localhost:3000
    BRIDGE_CLIENT_URL=http://localhost:4000
    IMAGES_SERVER=1
    IMAGES_SERVER_URL=http://localhost:3001
    MONGO_URL=mongodb://localhost:27017/influence
    #REDIS_URL=
    CLOUDINARY_URL=
    NODE_ENV=development
    JWT_SECRET=
    ETHEREUM_PROVIDER=http://localhost:8545
    CONTRACT_PLANETS=
    CONTRACT_ASTEROID_TOKEN=
    CONTRACT_ASTEROID_FEATURES=
    CONTRACT_ASTEROID_SCANS=
    CONTRACT_ASTEROID_SALE=
    CONTRACT_ASTEROID_NAMES=
    CONTRACT_ARVAD_CREW_SALE=
    CONTRACT_CREW_TOKEN=
    CONTRACT_CREW_FEATURES=
    CONTRACT_CREW_NAMES=
    " > .env
    ```
1. Adjust or fill in any missing .env variables as needed.
  - `REDIS_URL` is optional (uncomment if you plan to use it)
  - `JWT_SECRET` can be any random string
  - `CONTRACT_*` values should have been output at the end of the `seedChain` script in the [contracts](https://github.com/influenceth/contracts) project.
1. Install Homebrew (https://brew.sh)
1. Install mongodb tools `brew tap mongodb/brew` then `brew install mongodb-community@4.4`
1. Download [this seed data](https://drive.google.com/file/d/1VAWrANmzb7GNHf8WvzDbprNXlW0L_iNu/view?usp=sharing) for local development. Unzip the file into `./data`
1. Run `NODE_ENV=development node ./bin/seedData.js` to reset the database
1. Run `npm run watch` to start

## Fixing "stuck" scans
1. Run `node ./bin/updateCommon.js` with the `findStuck` method uncommented.
2. Grab the output and run `truffle test ./test/lib/TestScansMock.js` with the output in the contracts project.
3. Get the output from #2 and run `node ./bin/updateCommon.js` with `updateDatabase` method uncommented.

## Running as a Docker container 🐋
Notes:
- The `compose.yaml` file in the project expects a Docker network named `web` for the communication across containers (your mongo, redis, elasticsearch instances, optionally your own Starknet node if you want to run indexers, or a reverse-proxy e.g. Caddy). To create it, run `docker network create web` .
- By default the application port (3001) is only exposed to the `web` Docker network and not to the host machine. Un-comment the port configuration in `compose.yaml` if needed.
- The `compose.yaml` file includes the setup of redis and elasticsearch instances; the mongo instance is not included; initialisation of these services is not included.

### Build and run a development image
1. Download source
2. Initialize your `.env` file from `.env.example` with `NODE_ENV=development`
3. Build the image from local source: `docker compose build`
4. Start the container(s): `docker compose up -d`

### Build and run the unit tests image
1. Download source
2. Build the image from local source: `docker compose -f compose.unittest.yaml build`
3. Start the container to run unit tests: `docker compose -f compose.unittest.yaml up`

### Run an official prerelease or production image
1. Download the compose files for the deployment role, or download all `compose*.yaml` files.
2. Initialize your `.env` file from `.env.example` with `NODE_ENV` for the deployment role; *if running against a local redis instance, set `REDIS_DISABLE_TLS=1`*
3. Start prerelease: `./bin/start-container.sh prerelease`
4. Start production: `./bin/start-container.sh production`

The deploy script renders the merged compose config before starting containers, refuses to deploy if the app service
would bind-mount local source files into `/app`, pulls the latest configured image, and then runs `docker compose up -d`.

### Offchain purchase grant signing key
The off-chain starter pack and individual crewmate flows submit Starknet transactions from a dedicated admin account
after Stripe confirms payment and the player submits completed customization. Provisioning calls the configured
Dispatcher entrypoint `run_system` with `GrantOffchainStarterPack` or `GrantOffchainCrewmate` as the system name.
Purchasing, Stripe webhooks, grant provisioning, and AVNU fee subsidies are disabled by default so
open-source nodes can index grant activity without holding official payment credentials, AVNU credentials, or
the grant signer key.

Community-run nodes should leave these unset or disabled:
```
STARTER_PACK_PROVISIONER_ENABLED=0
CREWMATE_PROVISIONER_ENABLED=0
AVNU_PAYMASTER_ENABLED=0
BANXA_CHECKOUT_ENABLED=0
```

The client retrieves the available products with `GET /v2/starter-packs/products`. Product `name`, `description`, and
`features` come from the corresponding Stripe Product; entitlement counts and buildings come from the server's
canonical starter pack definitions.

The purchase flow is:
1. Authenticated client creates a Checkout Session with
   `POST /v2/starter-packs/checkout`, passing `productId` or `packType`, `returnUrl`, and optionally `recipient`.
   The recipient must match the authenticated purchaser address.
   `returnUrl` should include the literal `{CHECKOUT_SESSION_ID}` template variable so the client can resume the
   correct purchase after a redirect-based authorization flow.
   The response contains `clientSecret` for mounting Stripe Embedded Checkout, plus `checkoutSessionId` and the
   persisted `purchase`. Stripe redirects to `returnUrl` only for payment methods that require an external
   authorization flow.
2. Stripe sends `checkout.session.completed`; the webhook verifies the event, confirms `payment_status=paid`, and
   stores the purchase as `paid_pending_customization`.
3. Client resumes with `GET /v2/starter-packs/pending` or
   `GET /v2/starter-packs/checkout/:checkoutSessionId`.
   The checkout lookup also returns `clientSecret` while the purchase is still `checkout_created`, allowing the client
   to remount the same Embedded Checkout after a refresh or an incomplete redirect-based payment.
4. After the player creates all required crewmates, client submits the grant payload with
   `POST /v2/starter-packs/customization`.
5. Client waits for the indexer to observe `OffchainStarterPackGranted` and the related starter pack components.

Individual crewmate purchases use the same embedded Checkout lifecycle through these authenticated endpoints:

- `GET /v2/crewmate-purchases/products`
- `POST /v2/crewmate-purchases/checkout`
- `GET /v2/crewmate-purchases/pending`
- `GET /v2/crewmate-purchases/checkout/:checkoutSessionId`
- `POST /v2/crewmate-purchases/customization`

The configured Stripe Product supplies the product name, description, marketing features, price, and currency. Create
Checkout with `productId`, `returnUrl`, and optionally `recipient`; `recipient` must equal the authenticated account.
After payment reaches `paid_pending_customization`, submit the purchase `id` and this `grantRequest`:

```json
{
  "purchaseId": "...",
  "grantRequest": {
    "station": { "label": 5, "id": 1 },
    "callerCrew": { "label": 1, "id": 42 },
    "class": 2,
    "impactful": [10],
    "cosmetic": [11, 12, 13],
    "gender": 1,
    "body": 2,
    "face": 3,
    "hair": 4,
    "hairColor": 5,
    "clothes": 6,
    "name": "Ada"
  }
}
```

The server verifies indexed ownership of `callerCrew`, derives the Stripe checkout hash used as `external_ref`, sets
`restricted_until` to 14 days from submission, and invokes `GrantOffchainCrewmate`. The client should wait until the
purchase reaches `grant_confirmed`, which occurs when the indexer handles `OffchainCrewmateGranted`. That response
contains `grantedCrewmate` and `grantedCrew`; the normal component events update the resulting crew and crewmate.

The purchase refund window and starter pack subsidy window are separate. The refund window closes when the server
submits the starter pack grant transaction, or 14 days after Stripe payment if customization never completes. The
subsidized Starknet fee window starts from the indexed `OffchainStarterPackGranted` timestamp and lasts 14 days. The
server also owns the `restrictedUntil` value sent to the grant transaction so on-chain starter restrictions are based
on grant submission timing, not client-supplied payment timing.

Prerelease may use a raw private key in `.env`:
```
NODE_ENV=prerelease
STARTER_PACK_PROVISIONER_ENABLED=1
CREWMATE_PROVISIONER_ENABLED=1
STARKNET_STARTER_PACK_ADMIN=0x...
STARKNET_STARTER_PACK_PRIVATE_KEY=0x...
STARKNET_RPC_PROVIDER=https://...
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_CREWMATE_PRODUCT_ID=prod_...
STRIPE_STARTER_PACK_EXPLORER_PRODUCT_ID=prod_...
STRIPE_STARTER_PACK_STRATEGIST_PRODUCT_ID=prod_...
STRIPE_STARTER_PACK_INDUSTRIALIST_PRODUCT_ID=prod_...
```
Run with `./bin/start-container.sh prerelease`.

Production should use a key file mounted read-only into the API container. Do not put the production private key in
`.env`.

1. Create the key file on the host:
    ```
    sudo mkdir -p /etc/influence/secrets
    sudo install -m 0400 -o root -g root starter_pack_admin_private_key \
      /etc/influence/secrets/starter_pack_admin_private_key
    ```
2. Set the non-secret values in `.env`:
    ```
    NODE_ENV=production
    STARTER_PACK_PROVISIONER_ENABLED=1
    CREWMATE_PROVISIONER_ENABLED=1
    STARKNET_STARTER_PACK_ADMIN=0x...
    STARKNET_RPC_PROVIDER=https://...
    STRIPE_SECRET_KEY=sk_...
    STRIPE_WEBHOOK_SECRET=whsec_...
    STRIPE_CREWMATE_PRODUCT_ID=prod_...
    STRIPE_STARTER_PACK_EXPLORER_PRODUCT_ID=prod_...
    STRIPE_STARTER_PACK_STRATEGIST_PRODUCT_ID=prod_...
    STRIPE_STARTER_PACK_INDUSTRIALIST_PRODUCT_ID=prod_...
    ```
3. `compose.provisioner-keyfile.yaml` mounts the host file at
   `/run/secrets/starter_pack_admin_private_key` and sets:
    ```
    STARKNET_STARTER_PACK_PRIVATE_KEY_FILE=/run/secrets/starter_pack_admin_private_key
   ```
   Run with `./bin/start-container.sh production --provisioner-keyfile`.

For production without offchain purchase provisioning, leave `STARTER_PACK_PROVISIONER_ENABLED=0` and
`CREWMATE_PROVISIONER_ENABLED=0`, then run `./bin/start-container.sh production`.

Use a dedicated Starknet account for this signer, authorize it only for starter pack grants, and keep only enough ETH
on it for transaction fees. To provision individual crewmates, the same account also needs Dispatcher role
`OFFCHAIN_STARTER_PACK_GRANTER` (currently role `2`). `GrantOffchainCrewmate` is a Dispatcher system name, not a
deployed contract address; its compiled class hash does not belong in server configuration.

Configure log alerts for these starter pack provisioning markers:
- `STARTER_PACK_GRANT_FAILED`: Stripe payment completed and customization was submitted, but the Starknet grant
  transaction was not submitted.
- `CREWMATE_GRANT_FAILED`: Stripe payment completed and customization was submitted, but the crewmate grant
  transaction was not submitted.

### AVNU gasfree paymaster proxy
The authenticated `POST /v2/paymaster` endpoint proxies Starknet.js SNIP-29 JSON-RPC requests to AVNU while keeping
the sponsorship API key on the server. Prerelease uses `https://sepolia.paymaster.avnu.fi`; production uses
`https://starknet.paymaster.avnu.fi`. Set `AVNU_PAYMASTER_ENABLED=1` and `AVNU_PAYMASTER_API_KEY` only on official
servers that should sponsor gas. The compose configuration already loads `.env` into the API container, so no
additional compose file is required. Separate prerelease and production API keys are recommended for independent usage
tracking and rotation. Requests are limited per authenticated user; the default is 120 requests per minute and can be
changed with
`AVNU_PAYMASTER_RATE_LIMIT_PER_MINUTE`.

Each starter pack has a default sponsored fee budget of 100 STRK across account deployment and the 14-day post-grant
subsidy window. The server reserves AVNU's `suggested_max_fee_in_strk` from `paymaster_buildTransaction`, rounded up to
the nearest milliSTRK, and `paymaster_executeTransaction` must match a recent reserved build response. The budget can be
changed with `AVNU_PAYMASTER_MAX_STARTER_PACK_BUDGET_STRK`; the reservation TTL defaults to 300 seconds and can be
changed with `AVNU_PAYMASTER_RESERVATION_TTL_SECONDS`.

The proxy permits `paymaster_isAvailable`, `paymaster_getSupportedTokens`, `paymaster_buildTransaction`, and
`paymaster_executeTransaction`. Transaction requests must use sponsored mode. The proxy validates the transaction
before forwarding it to AVNU.

Starter account deployment sponsorship is allowed only when:
- the requester is authenticated to Influence
- `transaction.type` is `deploy`
- `transaction.deployment.address` matches the authenticated user
- the recipient has a paid starter pack purchase in the current Starknet environment with status
  `paid_pending_customization`
- the account is not yet deployed on Starknet
- the deployment uses Ready v0.5 class hash
  `0x073414441639dcd11d1846f287650a00c60c416b9d3ba45d31c651672125b2c2`
- the deployment constructor calldata is `[guardian, publicKey, signerCount]`, with `guardian = 0x0`,
  `signerCount = 0x1`, `salt = publicKey`, and the recomputed address matching `deployment.address`

Sponsored invoke transactions are allowed only for confirmed starter pack recipients in the current Starknet
environment. The 14-day sponsorship window starts at the indexed `OffchainStarterPackGranted` timestamp, not the
Stripe payment timestamp. Multicalls are supported, but every call in the multicall must target one of:
- `Contracts.starknet.dispatcher` with entrypoint `run_system`
- `Contracts.starknet.sway` with entrypoint `transfer_with_confirmation`
- `Contracts.starknet.sway` with entrypoint `approve`
- `Contracts.starknet.escrow` with entrypoint `deposit`
- `Contracts.starknet.escrow` with entrypoint `withdraw`
- `Contracts.starknet.escrow` with entrypoint `start_force_withdraw`
- `Contracts.starknet.escrow` with entrypoint `finish_force_withdraw`

Client setup with Starknet.js:
```js
const paymaster = new PaymasterRpc({
  nodeUrl: `${apiUrl}/v2/paymaster`,
  headers: { Authorization: `Bearer ${authToken}` }
});

const result = await account.execute(calls, {
  paymaster: {
    provider: paymaster,
    params: {
      version: '0x1',
      feeMode: { mode: 'sponsored' }
    }
  }
});
```

The proxy does not sponsor requests for a wallet other than the authenticated user. AVNU may still decline sponsorship
due to credits, rate limits, unsupported calls, or its abuse controls; the client should surface the paymaster error and
allow the player to retry with normal gas payment.

### Banxa hosted checkout proxy
The authenticated Banxa checkout endpoints create hosted buy orders server-side while keeping the Banxa API key out of
the browser. Banxa checkout is disabled by default; enable it only on official servers with:
```
BANXA_CHECKOUT_ENABLED=1
BANXA_API_KEY=...
BANXA_PARTNER_REF=...
BANXA_WEBHOOK_API_KEY=...
BANXA_WEBHOOK_SECRET=...
```
Prerelease defaults to `https://api.banxa-sandbox.com`; production defaults to `https://api.banxa.com`. Override with
`BANXA_BASE_URL` only when Banxa gives us a different partner endpoint.

Checkout requires an authenticated Influence user whose Starknet wallet is already deployed. The requested
`walletAddress` must match the authenticated address, and the server confirms deployment with Starknet RPC before
creating a Banxa order.

Client flow:
1. `POST /v2/banxa/checkout`
    ```json
    {
      "walletAddress": "0x...",
      "fiat": "EUR",
      "fiatAmount": "25",
      "crypto": "USDC",
      "blockchain": "STARKNET",
      "returnUrl": "https://game.example/banxa/return"
    }
    ```
2. Server calls Banxa `POST /{partnerRef}/v2/buy` and returns:
    ```json
    {
      "order": {
        "orderId": "banxa_order_id",
        "checkoutUrl": "https://...",
        "status": "checkout_created"
      }
    }
    ```
3. Client immediately redirects to, or embeds, `order.checkoutUrl`.
4. Client can poll `GET /v2/banxa/orders/:orderId` after return. The server refreshes the order from Banxa's
   `GET /{partnerRef}/v2/orders/{orderId}` endpoint before responding, so the Banxa API key remains server-side.
   Poll no more than about once per minute and treat only `completed` as settled. Intermediate statuses are returned as
   `pending`.
5. The webhook endpoint is `POST /v2/banxa/webhook` and records Banxa status updates for known order IDs. Banxa webhook
   requests must include the documented HMAC `Authorization` header signed for `/v2/banxa/webhook`; the webhook API key
   and secret are the HMAC credentials from Banxa, not the v2 checkout `x-api-key`.

### Influence-server services
- influence-server: the main service, running the API server
- four indexer services under the `--indexer flag`, designed to run continuously and index the onchain events
  - influence-indexer
  - influence-ethereumeventretriever
  - influence-starkneteventretriever
  - influence-eventprocessor
- two auditor services designed to be scheduled in order to catch missed events or reorgs
  - influence-eventauditor - run every 10 minutes
  - influence-agreementauditor - run daily
- influence-tools: a maintenance image running `node` as the default command used to execute initialization scripts
