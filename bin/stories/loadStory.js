#!/usr/bin/env node
require('module-alias/register');
require('dotenv').config({ silent: true });
const mongoose = require('mongoose');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const { existsSync } = require('fs');
const Story = require('../src/common/storage/db/models/Story');

// Setup db connection
mongoose.connect(process.env.MONGO_URL);

const logger = console;
const done = function (error) {
  if (error) logger.error(error);
  logger.info('done');
  process.exit();
};

const argv = yargs(hideBin(process.argv))
  .option('file', {
    type: 'string',
    demand: true
  })
  .check((args) => {
    if (!existsSync(args.file)) throw new Error(`Specified file does not exist: ${args.file}`);
    return true;
  })
  .parse();

const main = async function ({ file }) {
  // Load json file
  const data = require(`${__dirname}/../${file}`); // eslint-disable-line
  const { _id, createdAt, updatedAt } = await Story.findOneAndUpdate(
    { _id: data._id },
    data,
    { new: true, upsert: true }
  );
  const result = (createdAt.toString() === updatedAt.toString()) ? 'created' : 'updated';
  logger.info(`Story [${_id}] ${result} successfully.`);
};

main(argv)
  .then(() => done())
  .catch(done);
