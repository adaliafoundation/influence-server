require('module-alias/register');
require('dotenv').config({ silent: true });
const moment = require('moment');
const { Permission } = require('@influenceth/sdk');
const { mongoose } = require('@common/storage/db');
const Entity = require('@common/lib/Entity');
const ComponentService = require('@common/services/Components/Component');
const PackedLotDataService = require('@common/services/PackedData/LotData');
const ElasticSearchService = require('@common/services/ElasticSearch');
const logger = require('@common/lib/logger');

const done = function (error) {
  if (error) logger.inspect(error, 'error');
  logger.info('done');
  process.exit();
};

const main = async function () {
  const timestamp = moment().unix();
  const filter = { endTime: { $lte: timestamp } };

  const count = await mongoose.model('PrepaidAgreementComponent').countDocuments(filter);
  const cursor = mongoose.model('PrepaidAgreementComponent').find(filter).cursor();

  logger.info(`Processing [${count}] expired prepaid lease agreements...`);
  for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
    if (doc.permission === Permission.IDS.USE_LOT) {
      logger.verbose(`Updating PackedLotData for lot: ${doc.entity.uuid}`);
      await PackedLotDataService.updateLotLeaseStatus(doc.entity);

      // get the building on the lot and re-index it in elasticsearch
      const locationCompDoc = await ComponentService
        .findOne('Location', { 'location.uuid': doc.entity.uuid, 'entity.label': Entity.IDS.BUILDING });

      if (locationCompDoc) await ElasticSearchService.queueEntityForIndexing(locationCompDoc.entity);
    }

    // if the agreement endTime over 7 days, delete the agreement
    // added `endTime: { $lte: timestamp }` to the filter to ensure we are not deleting agreements
    // that might have been updated after the initial query
    if (doc.endTime === 0 || (moment().diff(moment.unix(doc.endTime), 'day') > 7)) {
      logger.verbose(`Deleting expired prepaid agreement: ${doc._id}, permission: ${doc.permission}`);
      await mongoose.model('PrepaidAgreementComponent').deleteOne({ _id: doc._id, endTime: { $lte: timestamp } });
    }
  }
};

main()
  .then(done)
  .catch(done);
