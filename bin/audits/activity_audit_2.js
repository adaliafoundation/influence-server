/* eslint-disable max-classes-per-file */
require('dotenv').config({ silent: true });
require('module-alias/register');
const Entity = require('@common/lib/Entity');
const { mongoose } = require('@common/storage/db');

const logger = console;

const deliverySentAudit = async function ({ readOnly = true }) {
  let invalidCount = 0;
  let fixed = 0;
  const compoenntDocs = await mongoose.model('DeliveryComponent').find({ status: 1 });

  for (const compoenntDoc of compoenntDocs) {
    const activityDoc = await mongoose.model('Activity').findOne({
      'event.name': 'DeliverySent',
      'event.returnValues.delivery.id': compoenntDoc.entity.id
    }).sort({ 'event.timestamp': -1, 'event.transactionIndex': -1, 'event.logIndex': -1 });

    if (activityDoc && activityDoc.unresolvedFor === null) {
      invalidCount += 1;

      if (readOnly === false) {
        fixed += 1;
        activityDoc.set('unresolvedFor', [Entity.Crew(activityDoc.event.returnValues.callerCrew.id)]);
        await activityDoc.save();
      }
    }
  }

  return { fixed, invalidCount };
};

const materialProcessingStartedAudit = async function ({ readOnly = true }) {
  let invalidCount = 0;
  let fixed = 0;
  const processorComponents = await mongoose.model('ProcessorComponent').find({ status: 1 });

  for (const processorComponent of processorComponents) {
    const activityDoc = await mongoose.model('Activity').findOne({
      'event.name': 'MaterialProcessingStarted',
      'event.returnValues.processor.id': processorComponent.entity.id,
      'event.returnValues.processorSlot': processorComponent.slot
    }).sort({ 'event.timestamp': -1, 'event.transactionIndex': -1, 'event.logIndex': -1 });

    if (activityDoc && activityDoc.unresolvedFor === null) {
      invalidCount += 1;

      if (readOnly === false) {
        fixed += 1;
        activityDoc.set('unresolvedFor', [Entity.Crew(activityDoc.event.returnValues.callerCrew.id)]);
        await activityDoc.save();
      }
    }
  }

  return { fixed, invalidCount };
};

const resourceExtractionStartedAudit = async function ({ readOnly = true }) {
  let invalidCount = 0;
  let fixed = 0;
  const componentDocs = await mongoose.model('ExtractorComponent').find({ status: 1 });

  for (const componentDoc of componentDocs) {
    const activityDoc = await mongoose.model('Activity').findOne({
      'event.name': 'ResourceExtractionStarted',
      'event.returnValues.extractor.id': componentDoc.entity.id,
      'event.returnValues.extractorSlot': componentDoc.slot
    }).sort({ 'event.timestamp': -1, 'event.transactionIndex': -1, 'event.logIndex': -1 });

    if (activityDoc && activityDoc.unresolvedFor === null) {
      invalidCount += 1;

      if (readOnly === false) {
        fixed += 1;
        activityDoc.set('unresolvedFor', [Entity.Crew(activityDoc.event.returnValues.callerCrew.id)]);
        await activityDoc.save();
      }
    }
  }
  return { fixed, invalidCount };
};

const shipAssemblyStartedAudit = async function ({ readOnly = true }) {
  let invalidCount = 0;
  let fixed = 0;

  const componentDocs = await mongoose.model('DryDockComponent').find({ status: 1 });

  for (const componentDoc of componentDocs) {
    const activityDoc = await mongoose.model('Activity').findOne({
      'event.name': 'ShipAssemblyStarted',
      'event.returnValues.dryDock.id': componentDoc.entity.id,
      'event.returnValues.dryDockSlot': componentDoc.slot
    }).sort({ 'event.timestamp': -1, 'event.transactionIndex': -1, 'event.logIndex': -1 });

    if (activityDoc && activityDoc.unresolvedFor === null) {
      invalidCount += 1;
      if (readOnly === false) {
        fixed += 1;
        activityDoc.set('unresolvedFor', [Entity.Crew(activityDoc.event.returnValues.callerCrew.id)]);
        await activityDoc.save();
      }
    }
  }
  return { fixed, invalidCount };
};

const main = async function () {
  let { invalidCount, fixed, activityDocCount } = await deliverySentAudit({ readOnly: true });
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
    logger.error(error);
    process.exit();
  });
