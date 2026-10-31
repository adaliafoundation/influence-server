require('module-alias/register');
require('dotenv').config({ silent: true });
const { mongoose } = require('@common/storage/db');

const logger = console;

const main = async function () {
  let operationFailed = false;
  try {
    // Wait for the database connection.
    await mongoose.connection.asPromise();

    for (const modelName of Object.keys(mongoose.models)) {
      logger.info(`Syncing indexes for ${modelName}...`);

      const model = mongoose.model(modelName);
      const diffs = await model.diffIndexes();

      logger.info(`Diffs: ${JSON.stringify(diffs, null, 2)}`);

      await model.syncIndexes();
    }
  } catch (error) {
    operationFailed = true;
    throw error;
  } finally {
    // Close the connection on success or failure.
    try {
      await mongoose.disconnect();
    } catch (error) {
      if (!operationFailed) throw error;
      logger.error(error);
    }
  }
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error(error);
    process.exit(1);
  });
