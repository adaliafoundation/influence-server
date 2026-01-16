require('module-alias/register');
require('dotenv').config({ silent: true });
const { mongoose } = require('@common/storage/db');

const logger = console;

const done = function (error) {
  if (error) logger.error(error);
  process.exit();
};

const main = async function () {
  for (const modelName of Object.keys(mongoose.models)) {
    logger.info(`Snycing indexes for ${modelName}...`);
    const model = mongoose.model(modelName);
    const diffs = await model.diffIndexes();
    logger.info(`Diffs: ${JSON.stringify(diffs, null, 2)}`);
    await model.syncIndexes();
  }
};

main()
  .then(done)
  .catch(done);
