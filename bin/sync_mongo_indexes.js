// Load Influence's configuration and MongoDB models.
require('module-alias/register');
require('dotenv').config({ silent: true });
const { mongoose } = require('@common/storage/db');

const logger = console;

const main = async function () {
  // Preserve the original error if disconnect also fails.
  let operationFailed = false;
  try {
    // Wait for the database connection.
    await mongoose.connection.asPromise();

    // Process every registered model. One model can have many indexes.
    // Removed models are not processed; their collections remain untouched.
    for (const modelName of Object.keys(mongoose.models)) {
      logger.info(`Syncing indexes for ${modelName}...`);

      const model = mongoose.model(modelName);
      // Read-only comparison of desired versus existing indexes.
      const diffs = await model.diffIndexes();

      logger.info(`Diffs: ${JSON.stringify(diffs, null, 2)}`);

      // Create missing indexes and remove undeclared indexes.
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
      // Keep the original error if synchronization already failed.
      if (!operationFailed) throw error;
      logger.error(error);
    }
  }
};

// Return exit code 0 on success and 1 on failure.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error(error);
    process.exit(1);
  });
