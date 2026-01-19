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
