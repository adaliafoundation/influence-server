/**
 * Load test seed data into the database.
 *
 * Usage:
 *   node src/workers/loadSeedData.js --wallet 0xYOUR_STARKNET_WALLET_ADDRESS
 *   node src/workers/loadSeedData.js  (uses a default dev wallet)
 *   node src/workers/loadSeedData.js --wallets path/to/wallets.txt
 *
 * This populates the database with a set of starter entities:
 *   - 2 asteroids, 2 crews, 5 crewmates
 *   - 10 buildings (warehouse, extractor, refinery, factory, shipyard,
 *     bioreactor, marketplace, habitat, spaceport, tank farm)
 *   - 1 ship, inventories with resources, and all supporting components
 *   - A User document for the wallet
 *   - A WorldFork record (if not already present)
 *
 * When `--wallets <file>` is provided, each non-comment line is a
 * starknet address that gets its own starter loadout on top of the base
 * seed — see src/workers/walletLoadout.js for the per-wallet entity
 * layout.
 *
 * All base-seed IDs are low (< 100); wallet-loadout IDs start at 1000;
 * locally-generated IDs start at 100_000_001. These three ranges never
 * collide.
 */
require('module-alias/register');
require('dotenv').config({ silent: true });
require('@common/storage/db');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const sdk = require('@influenceth/sdk');
const { Address } = require('@influenceth/sdk');
const EntityLib = require('@common/lib/Entity');
const logger = require('@common/lib/logger');
const { buildWalletLoadout, mergeLoadouts } = require('./walletLoadout');

const SEED_DATA_PATH = path.resolve(__dirname, '../../test/seed/data.json');

const args = yargs(hideBin(process.argv))
  .option('wallet', {
    type: 'string',
    description: 'Starknet wallet address that will own the base-seed entities',
    default: '0x0669B0254bce827409e794EB6146d355Ed0dE3A7306ab8E4CDA9ed8C5A48b09d'
  })
  .option('wallets', {
    type: 'string',
    description: 'Path to a file with one starknet address per line — each receives its own starter loadout',
    default: null
  })
  .help()
  .parse();

/**
 * Read a wallets file. Each non-empty, non-comment line is an address.
 * Returns normalized (Address.toStandard) addresses in order, deduplicated.
 */
function readWallets(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const seen = new Set();
  const out = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    let addr;
    try {
      addr = Address.toStandard(trimmed);
    } catch (e) {
      logger.warn(`Skipping invalid address: ${trimmed}`);
      continue;
    }
    if (seen.has(addr)) continue;
    seen.add(addr);
    out.push(addr);
  }
  return out;
}

function replaceWallet(obj, address) {
  return JSON.parse(JSON.stringify(obj).replace(/"WALLET"/g, JSON.stringify(address)));
}

async function upsertArray(modelName, docs, matchFields) {
  const Model = mongoose.model(modelName);
  for (const doc of docs) {
    const filter = {};
    for (const f of matchFields) {
      // Support nested fields like 'entity.id'
      const val = f.split('.').reduce((o, k) => o?.[k], doc);
      filter[f] = val;
    }
    await Model.findOneAndUpdate(filter, doc, { upsert: true, new: true });
  }
}

async function main({ wallet, wallets: walletsFile }) {
  const walletAddress = Address.toStandard(wallet);
  logger.info(`Loading seed data for wallet: ${walletAddress}`);

  // Wait for DB connection
  if (mongoose.connection.readyState !== 1) {
    await new Promise((resolve) => mongoose.connection.once('open', resolve));
  }

  const seedData = require(SEED_DATA_PATH); // eslint-disable-line global-require

  // ── Per-wallet starter loadouts ────────────────────────────────────────
  // If the caller passed --wallets, build a loadout for every address and
  // merge the arrays into the existing seed structures so the rest of the
  // loader treats them identically to the base seed.
  let walletLoadoutSummary = null;
  if (walletsFile) {
    const addresses = readWallets(walletsFile);
    if (addresses.length === 0) {
      logger.warn(`No wallet addresses found in ${walletsFile}`);
    } else {
      const loadouts = addresses.map((addr, i) => buildWalletLoadout({
        walletAddress: addr,
        index: i,
        sdk
      }));
      const merged = mergeLoadouts(loadouts);

      // Append each merged array onto the matching seed key (creating
      // the key if the base seed doesn't have it — which doesn't happen
      // in practice but is defensive).
      for (const [key, arr] of Object.entries(merged)) {
        if (!seedData[key]) seedData[key] = [];
        seedData[key].push(...arr);
      }
      walletLoadoutSummary = { addresses, count: addresses.length };
      logger.info(`  Wallet loadouts prepared: ${addresses.length}`);
    }
  }

  // Constants
  for (const c of (seedData.constants || [])) {
    await mongoose.model('Constant').findOneAndUpdate({ name: c.name }, c, { upsert: true, new: true });
  }
  logger.info(`  Constants: ${(seedData.constants || []).length}`);

  // Entities
  for (const ent of seedData.entities) {
    const uuid = EntityLib.toUuid(ent.id, ent.label);
    await mongoose.model('Entity').updateOne(
      { uuid },
      { $setOnInsert: { id: ent.id, label: ent.label, uuid } },
      { upsert: true }
    );
  }
  logger.info(`  Entities: ${seedData.entities.length}`);

  // NFTs (wallet-stamped)
  const nfts = replaceWallet(seedData.nftComponents, walletAddress);
  await upsertArray('NftComponent', nfts, ['entity.id', 'entity.label']);

  // Celestial
  await upsertArray('CelestialComponent', seedData.celestialComponents, ['entity.id', 'entity.label']);

  // Orbit
  await upsertArray('OrbitComponent', seedData.orbitComponents, ['entity.id', 'entity.label']);

  // Names
  await upsertArray('NameComponent', seedData.nameComponents, ['entity.id', 'entity.label']);

  // Crews (wallet-stamped)
  const crews = replaceWallet(seedData.crewComponents, walletAddress);
  await upsertArray('CrewComponent', crews, ['entity.id', 'entity.label']);

  // Crewmates
  await upsertArray('CrewmateComponent', seedData.crewmateComponents, ['entity.id', 'entity.label']);

  // Locations
  for (const l of seedData.locationComponents) {
    await mongoose.model('LocationComponent').findOneAndUpdate(
      { 'entity.id': l.entity.id, 'entity.label': l.entity.label },
      { entity: l.entity, location: l.location, locations: l.locations || [] },
      { upsert: true, new: true }
    );
  }

  // Control
  await upsertArray('ControlComponent', seedData.controlComponents, ['entity.id', 'entity.label']);

  // Buildings
  await upsertArray('BuildingComponent', seedData.buildingComponents, ['entity.id', 'entity.label']);

  // Ships
  await upsertArray('ShipComponent', seedData.shipComponents || [], ['entity.id', 'entity.label']);

  // Inventories
  for (const inv of seedData.inventoryComponents) {
    if (inv.contents?.length > 0 && !inv.mass) {
      inv.mass = inv.contents.reduce((sum, c) => sum + (c.amount || 0), 0);
    }
    await mongoose.model('InventoryComponent').findOneAndUpdate(
      { 'entity.id': inv.entity.id, 'entity.label': inv.entity.label, slot: inv.slot },
      inv, { upsert: true, new: true }
    );
  }

  // Stations
  await upsertArray('StationComponent', seedData.stationComponents, ['entity.id', 'entity.label']);

  // Exchanges
  await upsertArray('ExchangeComponent', seedData.exchangeComponents || [], ['entity.id', 'entity.label']);

  // Public policies
  for (const pp of (seedData.publicPolicyComponents || [])) {
    await mongoose.model('PublicPolicyComponent').findOneAndUpdate(
      { 'entity.id': pp.entity.id, 'entity.label': pp.entity.label, permission: pp.permission },
      pp, { upsert: true, new: true }
    );
  }

  // Docks
  await upsertArray('DockComponent', seedData.dockComponents || [], ['entity.id', 'entity.label']);

  // Extractors
  await upsertArray('ExtractorComponent', seedData.extractorComponents || [], ['entity.id', 'entity.label']);

  // Processors
  await upsertArray('ProcessorComponent', seedData.processorComponents || [], ['entity.id', 'entity.label']);

  // DryDocks
  await upsertArray('DryDockComponent', seedData.dryDockComponents || [], ['entity.id', 'entity.label']);

  // User records — the base-seed wallet, plus one per --wallets address.
  const allWallets = [walletAddress, ...(walletLoadoutSummary?.addresses || [])];
  for (const addr of allWallets) {
    await mongoose.model('User').findOneAndUpdate(
      { address: addr },
      { $setOnInsert: { address: addr } },
      { upsert: true, new: true }
    );
  }

  // WorldFork (create if missing)
  const existingFork = await mongoose.model('WorldFork').findOne({});
  if (!existingFork) {
    await mongoose.model('WorldFork').create({
      blockNumber: 0, blockHash: '0x0', blockTimestamp: new Date(), forkedAt: new Date(), label: 'seed-data'
    });
    logger.info('  WorldFork: created (empty)');
  } else {
    logger.info(`  WorldFork: already exists (block ${existingFork.blockNumber})`);
  }

  // Build packed lot data for lots that have buildings/ships so the map shows icons.
  // We only update the occupied lots instead of calling build() which iterates all
  // 1.7M+ lots on an asteroid (would take hours for seed data with ~10 buildings).
  const { PackedLotDataService } = require('@common/services'); // eslint-disable-line global-require
  const asteroidIds = [...new Set(seedData.entities.filter((e) => e.label === 3).map((e) => e.id))];
  for (const asteroidId of asteroidIds) {
    const asteroidEntity = { id: asteroidId, label: 3 };
    await PackedLotDataService.initForAsteroid(asteroidEntity);
    logger.info(`  Initialized packed lot data for asteroid ${asteroidId}`);
  }

  // Find lots with buildings or ships and update just those
  const occupiedLots = seedData.locationComponents
    .filter((l) => (l.entity.label === 5 || l.entity.label === 6) && l.location.label === 4);
  for (const loc of occupiedLots) {
    await PackedLotDataService.update(loc.location);
  }
  logger.info(`  Updated packed lot data for ${occupiedLots.length} occupied lots`);

  if (walletLoadoutSummary) {
    logger.info(`  Wallet loadouts inserted: ${walletLoadoutSummary.count}`);
    walletLoadoutSummary.addresses.forEach((a, i) => {
      logger.info(`    [${i}] ${a}`);
    });
  }

  logger.info('Seed data loaded successfully.');
}

main(args)
  .then(() => { process.exit(0); })
  .catch((err) => { logger.error(err); process.exit(1); });
