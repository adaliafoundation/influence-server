const mongoose = require('mongoose');
const { invert, isArray } = require('lodash');
const Entity = require('@common/lib/Entity');
const ElasticSearch = require('@common/storage/elasticsearch');
const logger = require('@common/lib/logger');
const formatters = require('@common/lib/elasticsearch/formatters');

const DEFAULT_BATCH_SIZE_BYTES = 2_500_000; // in bytes
const DEFAULT_BATCH_SIZE_COUNT = 2_000;

class Indexer {
  #batchSizeCount;

  #batchSizeBytes;

  #esClient;

  #currentBatchSizeBytes = 0;

  #currentBatchSizeCount = 0;

  #indexActions = [];

  #dbActions = [];

  #stats = { indexed: 0 };

  constructor(props = {}) {
    this.#batchSizeBytes = Number(props.batchSizeBytes || DEFAULT_BATCH_SIZE_BYTES);
    this.#batchSizeCount = Number(props.batchSizeCount || DEFAULT_BATCH_SIZE_COUNT);
    this.#esClient = props.esClient || ElasticSearch.client;

    if (!this.#esClient) throw new Error('ElasticSearch client missing or invalid');
    if (!this.#batchSizeBytes) throw new Error('batchSizeBytes missing or invalid');
    if (!this.#batchSizeCount) throw new Error('batchSizeCount missing or invalid');
  }

  static bulkIndex({ docs, stream, ...options } = {}) {
    const indexer = new Indexer(options);
    return indexer.bulk({ docs, stream, ...options });
  }

  getFormatters(indexItemDoc) {
    let result;

    switch (indexItemDoc.model) {
      case 'OrderComponent': {
        result = formatters.order;
        break;
      }
      case 'Entity': {
        const _entity = Entity.toEntity(indexItemDoc.identifier);
        result = formatters[invert(Entity.IDS)[_entity.label]?.toLowerCase()];
        break;
      }
      default: {
        throw new Error(`No formatter found for model: ${JSON.stringify(indexItemDoc, null, 2)}`);
      }
    }

    if (!result) throw new Error(`No formatter found for model: ${JSON.stringify(indexItemDoc, null, 2)}`);

    return result;
  }

  async bulk({ docs, stream, ...options } = {}) {
    if (docs) {
      for (const doc of docs) {
        await this.handleDocument(doc, options);
      }
    } else if (stream) {
      for await (const doc of stream) {
        await this.handleDocument(doc, options);
      }
    } else {
      throw new Error('No documents or stream provided');
    }

    // one last flush
    if (this.#indexActions.length > 0) await this.flush();
  }

  async handleDocument(doc, options = {}) {
    if (this.#currentBatchSizeBytes >= this.#batchSizeBytes
      || this.#currentBatchSizeCount >= this.#batchSizeCount) await this.flush();

    // important to flush (if needed) before calling `onDocument`
    await this.onDocument(doc);

    const indexFormatters = this.getFormatters(doc);

    for (const v of Object.keys(indexFormatters)) {
      const formatter = indexFormatters[v];
      const result = await formatter(doc, options);

      // eslint-disable-next-line no-continue
      if (!result) continue;

      const actions = [];
      if (isArray(result)) {
        result.forEach(({ _id, _index, formatted }) => {
          actions.push({ index: { _index, _id } });
          actions.push(formatted);
        });
      } else {
        const { _id, _index, formatted } = result;
        actions.push({ index: { _index, _id } });
        actions.push(formatted);
      }

      this.#currentBatchSizeBytes += Buffer.byteLength(JSON.stringify(actions));
      this.#currentBatchSizeCount += actions.length / 2;
      this.#indexActions.push(...actions);
    }
  }

  async onDocument(doc) {
    this.#dbActions.push({ deleteOne: { filter: { _id: doc._id } } });
  }

  resetDbBulkActions() {
    this.#dbActions.length = 0;
  }

  resetCurrentBatchStats() {
    this.#currentBatchSizeBytes = 0;
    this.#currentBatchSizeCount = 0;
  }

  resetIndexBulkActions() {
    this.#indexActions.length = 0;
  }

  incrementIndexed(value) {
    this.#stats.indexed += value;
  }

  async flush() {
    logger.info(`Indexer::flush, batchsize (bytes): ${this.#currentBatchSizeBytes}`);
    logger.info(`Indexer::flush, batchsize (count): ${this.#currentBatchSizeCount}`);
    const result = await this.#esClient.bulk({ body: this.#indexActions, refresh: true });
    if (result.errors) {
      logger.error(`Indexing error: ${JSON.stringify(result, null, 2)}`);
      throw new Error('DEBUG: bulkIndex failed');
    }

    this.incrementIndexed(this.#indexActions.length / 2);

    this.resetIndexBulkActions();
    this.resetCurrentBatchStats();

    // flush db actions
    await this.flushDbActions();
  }

  async flushDbActions() {
    if (this.#dbActions.length > 0) await mongoose.model('IndexItem').bulkWrite(this.#dbActions);
    this.resetDbBulkActions();
  }
}

module.exports = Indexer;
