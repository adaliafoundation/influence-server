require('module-alias/register');
require('dotenv').config({ silent: true });
const { get } = require('lodash');
const yargs = require('yargs/yargs');
const prompt = require('prompt');
const { Entity } = require('@influenceth/sdk');
const { mongoose } = require('@common/storage/db');
const { client } = require('@common/storage/elasticsearch');
const schemas = require('@common/storage/elasticsearch/schemas');
const { ElasticSearchService } = require('@common/services');
const logger = require('@common/lib/logger');

const getAlias = async function ({ type }) {
  const result = await client.cat.aliases({ format: 'json' });
  return (result.body || []).filter(({ alias }) => alias === type).pop();
};

const getSchema = function ({ type, version }) {
  const schema = get(schemas, [type, `v${version}`]);
  if (!schema) throw new Error(`No schema found for [${type}] [${version}]`);
  return schema;
};

const indexName = function ({ type, version }) {
  return `${type}_v${version}`;
};

const _createOrUpdateAlias = async function ({ type, version }) {
  const index = indexName({ type, version });
  const alias = await getAlias({ type });
  const request = { body: { actions: [{ add: { index, alias: type } }] } };
  if (alias) request.body.actions.push({ remove: { index: alias.index, alias: alias.alias } });
  return client.indices.updateAliases(request);
};

const _createIndex = async function ({ type, version }) {
  const index = indexName({ type, version });
  const body = getSchema({ type, version });
  if (!body) throw new Error(`Missing mappings/settins for ${type}`);
  logger.info(`creating index: ${index} for type: ${type}...`);
  await client.indices.create({ index, body });
  logger.info(`creating alias: ${type} -> ${index}...`);
  await _createOrUpdateAlias({ type, version });
};

// Commands
const createOrUpdateAlias = async function ({ type, version }) {
  await _createOrUpdateAlias({ type, version });
  process.exit(0);
};

const createIndex = async function ({ type, version }) {
  await _createIndex({ type, version });
  process.exit(0);
};

const dropAndCreate = async function ({ indices }) {
  for (const index of indices) {
    const [, type, version] = index.match(/([a-zA-Z]+)_v([1-9]+)/);
    if (!type || !Object.keys(schemas).includes(type)) throw new Error(`Invalid index: ${index}`);
    if (!version || !(Number(version) > 0)) throw new Error(`Invalid index: version ${version}`);
    logger.info(`dropping index: ${index}...`);
    await client.indices.delete({ index, ignore_unavailable: true });
    await _createIndex({ type, version });
  }

  process.exit(0);
};

const dropAllAndCreate = async function ({ version }) {
  prompt.start();
  const { response } = await prompt.get([
    {
      name: 'response',
      description: `Drop and recreate all indices for version: ${version}, proceed?`,
      required: true,
      type: 'string',
      pattern: /y|n/i
    }
  ]);

  if (response.toLowerCase() !== 'y') {
    logger.info('Cancelled');
    process.exit(0);
  }

  for (const type of Object.keys(schemas)) {
    const index = indexName({ type, version });
    logger.info(`dropping index: ${index}...`);
    await client.indices.delete({ index, ignore_unavailable: true });
    await _createIndex({ type, version });
  }
  process.exit(0);
};

const initialSetup = async function () {
  const version = 1;
  for (const type of Object.keys(schemas)) {
    const index = indexName({ type, version });
    const body = getSchema({ type, version });
    if (!body) throw new Error(`Missing mappings/settins for ${type}`);
    logger.info(`creating index: ${index} for type: ${type}...`);
    await client.indices.create({ index, body });
    logger.info(`creating alias: ${type} -> ${index}...`);
    await _createOrUpdateAlias({ type, version });
  }
  process.exit(0);
};

const reIndex = async function ({ indices }) {
  logger.info(`Reindexing documents for indicies: ${indices.join(', ')}`);
  for (const type of indices) {
    if (type === 'order') {
      const cursor = mongoose.model('OrderComponent').find({}).cursor();
      logger.info(`Queueing ${type.toUpperCase()} documents for reindexing...`);
      await ElasticSearchService.queueComponentsForIndexing({ cursor, component: 'OrderComponent', priority: 0 });
    } else {
      const label = Entity.IDS[type.toUpperCase()];
      if (!label) throw new Error(`Invalid type: ${type}`);
      logger.info(`Queueing ${type.toUpperCase()} documents for reindexing...`);
      const cursor = mongoose.model('Entity').find({ label }).cursor();
      await ElasticSearchService.queueEntitiesForIndexing({
        cursor,
        getEntityFromDoc: (doc) => ({ uuid: doc.uuid }),
        priority: 0
      });
    }
  }
  process.exit(0);
};

yargs(process.argv.slice(2))
  .command({
    command: 'createindex',
    desc: 'create an index',
    builder: (y) => {
      y.version(false);
      y.option('type', {
        alias: 't',
        describe: 'index type',
        choices: Object.keys(schemas),
        demand: true
      });
      y.option('version', {
        alias: 'v',
        describe: 'index version',
        type: 'number',
        demand: true
      });
    },
    handler: createIndex
  })
  .command({
    command: 'updatealias',
    desc: 'set/update the alias for an index',
    builder: (y) => {
      y.version(false);
      y.option('type', {
        alias: 't',
        describe: 'index type',
        choices: ['asteroid', 'lot'],
        demand: true
      });
      y.option('version', {
        alias: 'v',
        describe: 'index version',
        type: 'number',
        demand: true
      });
    },
    handler: createOrUpdateAlias
  })
  .command({
    command: 'initialSetup',
    desc: 'create all indices',
    builder: (y) => { y.version(false); },
    handler: initialSetup
  })
  .command({
    command: 'dropAndCreate',
    desc: 'drop the specified indices and recreate',
    builder: (y) => {
      y.version(false);
      y.option('indices', {
        describe: 'indices',
        type: 'array',
        demand: true
      });
    },
    handler: dropAndCreate
  })
  .command({
    command: 'dropAllAndCreate',
    desc: 'drop all indices and recreate for the specified version',
    builder: (y) => {
      y.version(false);
      y.option('version', {
        alias: 'v',
        describe: 'index version',
        type: 'number',
        demand: true
      });
    },
    handler: dropAllAndCreate
  })
  .command({
    command: 'reIndex',
    desc: 'reindex documents for the specifed types',
    builder: (y) => {
      y.version(false);
      y.option('indices', {
        alias: 'i',
        describe: 'Indices to reindex',
        choices: Object.keys(schemas),
        default: Object.keys(schemas),
        demand: true,
        type: 'array'
      });
    },
    handler: reIndex
  })
  .parse();
