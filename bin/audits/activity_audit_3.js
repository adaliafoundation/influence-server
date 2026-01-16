/* eslint-disable max-classes-per-file */
require('dotenv').config({ silent: true });
require('module-alias/register');
const Entity = require('@common/lib/Entity');
const { mongoose } = require('@common/storage/db');
const logger = require('@common/lib/logger');

const done = function (error) {
  if (error) logger.error(error.message);
  logger.info('done');
  process.exit();
};

const auditMaterialProcessingStarted = async function ({ readOnly = true }) {
  const results = await mongoose.model('Activity').aggregate([
    {
      $match: {
        'event.name': 'MaterialProcessingStarted',
        unresolvedFor: { $ne: null }
      }
    },
    {
      $group: {
        _id: '$event.returnValues.processor.id',
        count: { $count: {} },
        activities: { $push: { _id: '$_id', event: '$event', unresolvedFor: '$unresolvedFor' } }
      }
    },
    {
      $match: { count: { $gt: 1 } }
    }
  ]);

  logger.info(`Found ${results.length} processors with more than one unresolved activities`);
  for (const result of results) {
    logger.info(`count for result ${result._id}: ${result.count}`);

    // pop the most recent activity doc, we do not want to modify it
    result.activities.pop();

    // update all other activities, set unresolvedFor to null
    for (const activity of result.activities) {
      logger.info(`updating activity ${activity._id} for processor ${result._id}`);
      if (readOnly === false) {
        await mongoose.model('Activity').updateOne({ _id: activity._id }, { $set: { unresolvedFor: null } });
      }
    }
  }
  return results.length;
};

const auditResourceExtractionStarted = async function ({ readOnly = true }) {
  const results = await mongoose.model('Activity').aggregate([
    {
      $match: {
        'event.name': 'ResourceExtractionStarted',
        unresolvedFor: { $ne: null }
      }
    },
    {
      $group: {
        _id: '$event.returnValues.extractor.id',
        count: { $count: {} },
        activities: { $push: { _id: '$_id', event: '$event', unresolvedFor: '$unresolvedFor' } }
      }
    },
    {
      $match: { count: { $gt: 1 } }
    }
  ]);

  logger.info(`Found ${results.length} extractors with more than one unresolved activities`);
  for (const result of results) {
    logger.info(`count for result ${result._id}: ${result.count}`);

    // pop the most recent activity doc, we do not want to modify it
    result.activities.pop();

    // update all other activities, set unresolvedFor to null
    for (const activity of result.activities) {
      logger.info(`updating activity ${activity._id} for extractor ${result._id}`);
      if (readOnly === false) {
        await mongoose.model('Activity').updateOne({ _id: activity._id }, { $set: { unresolvedFor: null } });
      }
    }
  }

  return results.length;
};

const auditShipAssemblyStarted = async function ({ readOnly = true }) {
  const results = await mongoose.model('Activity').aggregate([
    {
      $match: {
        'event.name': 'ShipAssemblyStarted',
        unresolvedFor: { $ne: null }
      }
    },
    {
      $group: {
        _id: '$event.returnValues.dryDock.id',
        count: { $count: {} },
        activities: { $push: { _id: '$_id', event: '$event', unresolvedFor: '$unresolvedFor' } }
      }
    },
    {
      $match: { count: { $gt: 1 } }
    }
  ]);

  logger.info(`Found ${results.length} dryDocks with more than one unresolved activities`);
  for (const result of results) {
    logger.info(`count for result ${result._id}: ${result.count}`);

    // pop the most recent activity doc, we do not want to modify it
    result.activities.pop();

    // update all other activities, set unresolvedFor to null
    for (const activity of result.activities) {
      logger.info(`updating activity ${activity._id} for dryDock ${result._id}`);
      if (readOnly === false) {
        await mongoose.model('Activity').updateOne({ _id: activity._id }, { $set: { unresolvedFor: null } });
      }
    }
  }

  return results.length;
};

const auditDeliverySent = async function ({ readOnly = true }) {
  const unresolvedResults = await mongoose.model('Activity').aggregate([
    {
      $match: {
        'event.name': 'DeliverySent',
        unresolvedFor: { $ne: null }
      }
    },
    {
      $lookup: {
        from: 'Component_Delivery',
        localField: 'event.returnValues.delivery.id',
        foreignField: 'entity.id',
        as: 'deliveries'
      }
    },
    {
      $match: { 'deliveries.status': 2 }
    }
  ]);

  logger.info(`Found ${unresolvedResults.length} deliveries`);
  if (readOnly === false) {
    for (const unresolvedResult of unresolvedResults) {
      await mongoose.model('Activity').updateOne({ _id: unresolvedResult._id }, { $set: { unresolvedFor: null } });
    }
  }

  const resolvedResults = await mongoose.model('Activity').aggregate([
    {
      $match: {
        'event.name': 'DeliverySent',
        unresolvedFor: null
      }
    },
    {
      $lookup: {
        from: 'Component_Delivery',
        localField: 'event.returnValues.delivery.id',
        foreignField: 'entity.id',
        as: 'deliveries'
      }
    },
    { $match: { 'deliveries.status': 4 } }
  ]);

  logger.info(`Found ${resolvedResults.length} deliveries`);
  if (readOnly === false) {
    for (const resolvedResult of resolvedResults) {
      const crew = Entity.Crew(resolvedResult.event.returnValues.callerCrew.id);
      await mongoose.model('Activity').updateOne({ _id: resolvedResult._id }, { $set: { unresolvedFor: [crew] } });
    }
  }

  return { unresolvedResults: unresolvedResults.length, resolvedResults: resolvedResults.length };
};

const main = async function () {
  // const results1 = await auditMaterialProcessingStarted({ readOnly: true });
  // const results2 = await auditResourceExtractionStarted({ readOnly: true });
  // const results3 = await auditShipAssemblyStarted({ readOnly: true });
  // const results4 = await auditDeliverySent({ readOnly: true });

  // console.log('results1', results1);
  // console.log('results2', results2);
  // console.log('results3', results3);
  // console.log('results4', results4);
};

main()
  .then(async () => {
    process.exit();
  })
  .catch((error) => {
    console.error(error);
    process.exit();
  });
