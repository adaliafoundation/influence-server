/* eslint-disable max-classes-per-file */
require('dotenv').config({ silent: true });
require('module-alias/register');
const Entity = require('@common/lib/Entity');
const { mongoose } = require('@common/storage/db');

const logger = console;

const deliverySentAudit = async function ({ readOnly = true }) {
  let invalidCount = 0;
  let fixed = 0;
  const activityDocs = await mongoose.model('Activity').find(
    { 'event.name': 'DeliverySent', 'unresolvedFor.uuid': { $exists: true } }
  );

  for (const activityDoc of activityDocs) {
    const entity = Entity.toEntity(activityDoc.event.returnValues.delivery);

    const compDoc = await mongoose.model('DeliveryComponent').findOne({ 'entity.uuid': entity.uuid, status: 2 });
    if (compDoc) {
      invalidCount += 1;
      if (readOnly === false) {
        fixed += 1;
        activityDoc.set('unresolvedFor', null);
        await activityDoc.save();
      }
    }
  }

  return { invalidCount, fixed, activityDocCount: activityDocs.length };
};

const materialProcessingStartedAudit = async function ({ readOnly = true }) {
  let invalidCount = 0;
  let fixed = 0;

  const activityDocs = await mongoose.model('Activity').find(
    { 'event.name': 'MaterialProcessingStarted', 'unresolvedFor.uuid': { $exists: true } }
  );

  for (const activityDoc of activityDocs) {
    const entity = Entity.toEntity(activityDoc.event.returnValues.processor);

    const compDoc = await mongoose.model('ProcessorComponent').findOne({
      'entity.uuid': entity.uuid,
      slot: activityDoc.event.returnValues.processorSlot,
      status: 0
    });

    if (compDoc) {
      invalidCount += 1;
      if (readOnly === false) {
        fixed += 1;
        activityDoc.set('unresolvedFor', null);
        await activityDoc.save();
      }
    }
  }

  return { invalidCount, fixed, activityDocCount: activityDocs.length };
};

const resourceExtractionStartedAudit = async function ({ readOnly = true }) {
  let invalidCount = 0;
  let fixed = 0;

  const activityDocs = await mongoose.model('Activity').find(
    { 'event.name': 'ResourceExtractionStarted', 'unresolvedFor.uuid': { $exists: true } }
  );

  for (const activityDoc of activityDocs) {
    const entity = Entity.toEntity(activityDoc.event.returnValues.extractor);

    const compDoc = await mongoose.model('ExtractorComponent').findOne({
      'entity.uuid': entity.uuid,
      slot: activityDoc.event.returnValues.extractorSlot,
      status: 0
    });

    if (compDoc) {
      invalidCount += 1;

      if (readOnly === false) {
        fixed += 1;
        activityDoc.set('unresolvedFor', null);
        await activityDoc.save();
      }
    }
  }

  return { invalidCount, fixed, activityDocCount: activityDocs.length };
};

const shipAssemblyStartedAudit = async function ({ readOnly = true }) {
  let invalidCount = 0;
  let fixed = 0;

  const activityDocs = await mongoose.model('Activity').find(
    { 'event.name': 'ShipAssemblyStarted', 'unresolvedFor.uuid': { $exists: true } }
  );

  for (const activityDoc of activityDocs) {
    const entity = Entity.toEntity(activityDoc.event.returnValues.dryDock);

    const compDoc = await mongoose.model('DryDockComponent').findOne({
      'entity.uuid': entity.uuid,
      slot: activityDoc.event.returnValues.dryDockSlot,
      status: 0
    });

    if (compDoc) {
      invalidCount += 1;

      if (readOnly === false) {
        fixed += 1;
        activityDoc.set('unresolvedFor', null);
        await activityDoc.save();
      }
    }
  }
  return { invalidCount, fixed, activityDocCount: activityDocs.length };
};

const main = async function () {
  let invalidCount;
  let fixed;
  let activityDocCount;

  ({ invalidCount, fixed, activityDocCount } = await deliverySentAudit({ readOnly: true }));
  logger.info(`DeliverySentAudit: ${fixed} of ${invalidCount} fixed of ${activityDocCount} total`);

  ({ invalidCount, fixed, activityDocCount } = await materialProcessingStartedAudit({ readOnly: true }));
  logger.info(`MaterialProcessingStartedAudit: ${fixed} of ${invalidCount} fixed of ${activityDocCount} total`);

  ({ invalidCount, fixed, activityDocCount } = await resourceExtractionStartedAudit({ readOnly: true }));
  logger.info(`ResourceExtractionStartedAudit: ${fixed} of ${invalidCount} fixed of ${activityDocCount} total`);

  ({ invalidCount, fixed, activityDocCount } = await shipAssemblyStartedAudit({ readOnly: true }));
  logger.info(`ShipAssemblyStartedAudit: ${fixed} of ${invalidCount} fixed of ${activityDocCount} total`);
};

main()
  .then(async () => {
    process.exit();
  })
  .catch((error) => {
    console.error(error);
    process.exit();
  });
