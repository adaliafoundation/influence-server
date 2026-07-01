require('module-alias/register');
require('dotenv').config({ silent: true });
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const { Permission } = require('@influenceth/sdk');
const { mongoose } = require('@common/storage/db');
const Entity = require('@common/lib/Entity');
const { ComponentService, ElasticSearchService, LotService } = require('@common/services');

const logger = console;

const done = function (error) {
  if (error) logger.error(error);
  process.exit(error ? 1 : 0);
};

const args = yargs(hideBin(process.argv))
  .option('days', {
    type: 'number',
    describe: 'Optional expired USE_LOT prepaid agreement lookback window to backfill'
  })
  .option('dryRun', {
    type: 'boolean',
    default: false,
    describe: 'Count matching events without writing component documents'
  })
  .help()
  .parse();

const agreementKey = function ({ entity, permission, permitted }) {
  if (!entity || !permitted) return null;
  return [
    Entity.toEntity(entity).uuid,
    permission,
    Entity.toEntity(permitted).uuid
  ].join(':');
};

const shouldRestore = function ({ endTime, permission, startTime }) {
  return permission === Permission.IDS.USE_LOT
    && startTime > 0
    && endTime > 0
    && endTime <= Math.floor(Date.now() / 1000);
};

const main = async function ({ days, dryRun }) {
  const now = Math.floor(Date.now() / 1000);
  const endTimeFilter = { $lte: now };
  if (days) endTimeFilter.$gt = now - (days * 24 * 60 * 60);

  const latestByAgreement = new Map();
  const touchedLotUuids = new Set();
  let matched = 0;
  let restored = 0;

  const cursor = mongoose.model('Event')
    .find({
      event: 'ComponentUpdated_PrepaidAgreement',
      'returnValues.permission': Permission.IDS.USE_LOT
    })
    .sort({ blockNumber: 1, transactionIndex: 1, logIndex: 1 })
    .cursor();

  for (let eventDoc = await cursor.next(); eventDoc != null; eventDoc = await cursor.next()) {
    const key = agreementKey(eventDoc.returnValues);
    if (key) latestByAgreement.set(key, eventDoc);
  }

  for (const eventDoc of latestByAgreement.values()) {
    const data = eventDoc.returnValues;
    if (!shouldRestore(data)) continue;
    if (data.endTime > endTimeFilter.$lte) continue;
    if (endTimeFilter.$gt && data.endTime <= endTimeFilter.$gt) continue;

    matched += 1;

    const lotEntity = Entity.toEntity(data.entity);
    touchedLotUuids.add(lotEntity.uuid);

    if (dryRun) continue;

    const result = await ComponentService.updateOrCreateFromEvent({
      component: 'PrepaidAgreement',
      event: eventDoc,
      data,
      replace: false
    });

    if (result.updated || result.created) restored += 1;
  }

  if (!dryRun) {
    for (const lotUuid of touchedLotUuids) {
      const lotEntity = Entity.fromUuid(lotUuid);
      await LotService.cleanupSupersededExpiredPrepaidLeases(lotEntity);
      await ElasticSearchService.queueEntityForIndexing(lotEntity);
    }
  }

  logger.info(`Matched expired USE_LOT prepaid agreement events: ${matched}`);
  logger.info(`Touched lots: ${touchedLotUuids.size}`);
  if (!dryRun) logger.info(`Restored/updated agreement components: ${restored}`);
};

main(args)
  .then(done)
  .catch(done);
