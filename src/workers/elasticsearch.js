require('module-alias/register');
require('dotenv').config({ silent: true });
const appConfig = require('config');
require('@common/storage/db');
const { mongoose } = require('@common/storage/db');
const { delay } = require('lodash');
const { Timer } = require('timer-node');
const logger = require('@common/lib/logger');
const Indexer = require('@common/lib/elasticsearch/Indexer');

const done = function (error) {
  if (error) logger.inspect(error, 'error');
  logger.info('done');
  process.exit();
};

const main = async function () {
  const keepRunning = true;
  const runDelay = appConfig.get('Elasticsearch.indexer.runDelay');
  const batchSizeBytes = appConfig.get('Elasticsearch.indexer.bulkBatchSizeBytes');
  const batchSizeCount = appConfig.get('Elasticsearch.indexer.bulkBatchSizeCount');
  const runItemLimit = appConfig.get('Elasticsearch.indexer.runItemLimit');

  while (keepRunning) {
    const timer = new Timer({ label: 'ElasticIndexer-timer' }).start();

    if (timer.ms() < runDelay) {
      const delayMs = runDelay - timer.ms();
      const totalCount = await mongoose.model('IndexItem').countDocuments({});
      const docs = await mongoose.model('IndexItem')
        .find({})
        .limit(runItemLimit)
        .sort({ priority: -1, createdAt: 1 }) // process higher priority first
        .lean();
      logger.info(`ElasticSearch Indexer, indexing [${docs.length}/${totalCount}]...`);
      await Indexer.bulkIndex({ batchSizeBytes, batchSizeCount, docs });

      logger.debug(`ElasticSearch Indexer, run delay not met, delaying for [${delayMs}ms]...`);
      await new Promise((resolve) => {
        delay(resolve, delayMs);
      });
    }
  }

  return null;
};

main()
  .then(done)
  .catch(done);
