#!/usr/bin/env node

/**
 * Seeds the local MongoDB with test entities for hybrid mode development.
 *
 * Usage:
 *   node test/seed/seed.js [--wallet 0xYOUR_ADDRESS] [--reset]
 *
 * Options:
 *   --wallet   Override the wallet address in data.json
 *   --reset    Drop all seeded collections before inserting
 */
require('module-alias/register');
require('dotenv').config({ silent: true });
require('@common/storage/db');

const mongoose = require('mongoose');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const EntityLib = require('@common/lib/Entity');
const logger = require('@common/lib/logger');
const seedData = require('./data.json');

const args = yargs(hideBin(process.argv))
  .option('wallet', {
    type: 'string',
    description: 'Starknet wallet address (overrides data.json)',
    default: null
  })
  .option('reset', {
    type: 'boolean',
    description: 'Drop seeded collections before inserting',
    default: false
  })
  .help()
  .parse();

const COLLECTIONS = [
  'Constant',
  'Entity',
  'NftComponent',
  'CelestialComponent',
  'OrbitComponent',
  'NameComponent',
  'CrewComponent',
  'CrewmateComponent',
  'LocationComponent',
  'ControlComponent',
  'BuildingComponent',
  'InventoryComponent',
  'StationComponent',
  'User',
  'WorldFork'
];

const replaceWallet = (obj, address) => JSON.parse(
  JSON.stringify(obj).replace(/"WALLET"/g, JSON.stringify(address))
);

const main = async () => {
  // Wait for DB connection
  await new Promise((resolve, reject) => {
    if (mongoose.connection.readyState === 1) return resolve();
    mongoose.connection.once('open', resolve);
    mongoose.connection.once('error', reject);
    return undefined;
  });

  const walletAddress = args.wallet || seedData.walletAddress;
  if (!walletAddress) {
    logger.error('No wallet address. Use --wallet 0xYOUR_ADDRESS or set walletAddress in data.json');
    process.exit(1);
  }
  logger.info(`Seeding with wallet: ${walletAddress}`);

  if (args.reset) {
    logger.info('Resetting collections...');
    for (const name of COLLECTIONS) {
      try {
        await mongoose.model(name).deleteMany({});
        logger.info(`  Cleared ${name}`);
      } catch (e) {
        logger.warn(`  Skipped ${name}: ${e.message}`);
      }
    }
  }

  // 0. Constants (TIME_ACCELERATION, CREW_SCHEDULE_BUFFER, etc.)
  const Constant = mongoose.model('Constant');
  for (const c of (seedData.constants || [])) {
    await Constant.findOneAndUpdate(
      { name: c.name },
      c,
      { upsert: true, new: true }
    );
  }
  logger.info(`Constants: ${(seedData.constants || []).length}`);

  // 1. Entities (compute uuid from id+label since updateOne bypasses mongoose middleware)
  const Entity = mongoose.model('Entity');
  for (const ent of seedData.entities) {
    const uuid = EntityLib.toUuid(ent.id, ent.label);
    await Entity.updateOne(
      { uuid },
      { $setOnInsert: { id: ent.id, label: ent.label, uuid } },
      { upsert: true }
    );
  }
  logger.info(`Entities: ${seedData.entities.length}`);

  // 2. Nft (ownership)
  const NftComponent = mongoose.model('NftComponent');
  const nfts = replaceWallet(seedData.nftComponents, walletAddress);
  for (const nft of nfts) {
    await NftComponent.findOneAndUpdate(
      { 'entity.id': nft.entity.id, 'entity.label': nft.entity.label },
      nft,
      { upsert: true, new: true }
    );
  }
  logger.info(`NftComponents: ${nfts.length}`);

  // 3. Celestial (asteroid properties)
  const CelestialComponent = mongoose.model('CelestialComponent');
  for (const c of seedData.celestialComponents) {
    await CelestialComponent.findOneAndUpdate(
      { 'entity.id': c.entity.id, 'entity.label': c.entity.label },
      c,
      { upsert: true, new: true }
    );
  }
  logger.info(`CelestialComponents: ${seedData.celestialComponents.length}`);

  // 4. Orbit
  const OrbitComponent = mongoose.model('OrbitComponent');
  for (const o of seedData.orbitComponents) {
    await OrbitComponent.findOneAndUpdate(
      { 'entity.id': o.entity.id, 'entity.label': o.entity.label },
      o,
      { upsert: true, new: true }
    );
  }
  logger.info(`OrbitComponents: ${seedData.orbitComponents.length}`);

  // 5. Names
  const NameComponent = mongoose.model('NameComponent');
  for (const n of seedData.nameComponents) {
    await NameComponent.findOneAndUpdate(
      { 'entity.id': n.entity.id, 'entity.label': n.entity.label },
      n,
      { upsert: true, new: true }
    );
  }
  logger.info(`NameComponents: ${seedData.nameComponents.length}`);

  // 6. Crew (delegatedTo uses WALLET placeholder)
  const CrewComponent = mongoose.model('CrewComponent');
  const crews = replaceWallet(seedData.crewComponents, walletAddress);
  for (const c of crews) {
    await CrewComponent.findOneAndUpdate(
      { 'entity.id': c.entity.id, 'entity.label': c.entity.label },
      c,
      { upsert: true, new: true }
    );
  }
  logger.info(`CrewComponents: ${crews.length}`);

  // 7. Crewmate
  const CrewmateComponent = mongoose.model('CrewmateComponent');
  for (const c of seedData.crewmateComponents) {
    await CrewmateComponent.findOneAndUpdate(
      { 'entity.id': c.entity.id, 'entity.label': c.entity.label },
      c,
      { upsert: true, new: true }
    );
  }
  logger.info(`CrewmateComponents: ${seedData.crewmateComponents.length}`);

  // 8. Location (includes pre-computed locations hierarchy)
  const LocationComponent = mongoose.model('LocationComponent');
  for (const l of seedData.locationComponents) {
    await LocationComponent.findOneAndUpdate(
      { 'entity.id': l.entity.id, 'entity.label': l.entity.label },
      { entity: l.entity, location: l.location, locations: l.locations || [] },
      { upsert: true, new: true }
    );
  }
  logger.info(`LocationComponents: ${seedData.locationComponents.length}`);

  // 9. Control
  const ControlComponent = mongoose.model('ControlComponent');
  for (const c of seedData.controlComponents) {
    await ControlComponent.findOneAndUpdate(
      { 'entity.id': c.entity.id, 'entity.label': c.entity.label },
      c,
      { upsert: true, new: true }
    );
  }
  logger.info(`ControlComponents: ${seedData.controlComponents.length}`);

  // 10. Building
  const BuildingComponent = mongoose.model('BuildingComponent');
  for (const b of seedData.buildingComponents) {
    await BuildingComponent.findOneAndUpdate(
      { 'entity.id': b.entity.id, 'entity.label': b.entity.label },
      b,
      { upsert: true, new: true }
    );
  }
  logger.info(`BuildingComponents: ${seedData.buildingComponents.length}`);

  // 11. Inventory
  const InventoryComponent = mongoose.model('InventoryComponent');
  for (const inv of seedData.inventoryComponents) {
    await InventoryComponent.findOneAndUpdate(
      { 'entity.id': inv.entity.id, 'entity.label': inv.entity.label, slot: inv.slot },
      inv,
      { upsert: true, new: true }
    );
  }
  logger.info(`InventoryComponents: ${seedData.inventoryComponents.length}`);

  // 12. Station
  const StationComponent = mongoose.model('StationComponent');
  for (const s of seedData.stationComponents) {
    await StationComponent.findOneAndUpdate(
      { 'entity.id': s.entity.id, 'entity.label': s.entity.label },
      s,
      { upsert: true, new: true }
    );
  }
  logger.info(`StationComponents: ${seedData.stationComponents.length}`);

  // 13. User
  const User = mongoose.model('User');
  await User.findOneAndUpdate(
    { address: walletAddress },
    { $setOnInsert: { address: walletAddress } },
    { upsert: true, new: true }
  );
  logger.info('User: 1');

  // 14. WorldFork (so health check passes)
  const WorldFork = mongoose.model('WorldFork');
  const existingFork = await WorldFork.findOne({});
  if (!existingFork) {
    await WorldFork.create({
      blockNumber: 0,
      blockHash: '0x0',
      blockTimestamp: new Date(),
      forkedAt: new Date(),
      label: 'local-seed'
    });
    logger.info('WorldFork: created (local-seed)');
  } else {
    logger.info(`WorldFork: already exists (${existingFork.label})`);
  }

  // Summary
  const counts = {};
  for (const name of COLLECTIONS) {
    try {
      counts[name] = await mongoose.model(name).countDocuments();
    } catch (e) {
      counts[name] = '?';
    }
  }
  logger.info('Seed complete. Document counts:');
  Object.entries(counts).forEach(([k, v]) => logger.info(`  ${k}: ${v}`));
};

main()
  .then(() => { logger.info('Done.'); process.exit(0); })
  .catch((err) => { logger.error(err); process.exit(1); });
