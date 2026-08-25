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

### Starter pack grant signing key
The off-chain starter pack flow submits Starknet transactions from a dedicated admin account after Stripe confirms
payment and the player submits their completed crewmate customization.
Starter pack provisioning is disabled by default so open-source nodes can index starter pack activity without holding
Stripe credentials or the grant signer key.

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

Prerelease may use a raw private key in `.env`:
```
NODE_ENV=prerelease
STARTER_PACK_PROVISIONER_ENABLED=1
STARKNET_STARTER_PACK_ADMIN=0x...
STARKNET_CONTRACT_GRANT_OFFCHAIN_STARTER_PACK=0x...
STARKNET_STARTER_PACK_PRIVATE_KEY=0x...
STARKNET_RPC_PROVIDER=https://...
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
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
    STARKNET_STARTER_PACK_ADMIN=0x...
    STARKNET_CONTRACT_GRANT_OFFCHAIN_STARTER_PACK=0x...
    STARKNET_RPC_PROVIDER=https://...
    STRIPE_SECRET_KEY=sk_...
    STRIPE_WEBHOOK_SECRET=whsec_...
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

For production without starter pack provisioning, leave `STARTER_PACK_PROVISIONER_ENABLED=0` and run
`./bin/start-container.sh production`.

Use a dedicated Starknet account for this signer, authorize it only for starter pack grants, and keep only enough ETH
on it for transaction fees.

Configure log alerts for these starter pack provisioning markers:
- `STARTER_PACK_GRANT_FAILED`: Stripe payment completed and customization was submitted, but the Starknet grant
  transaction was not submitted.

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
