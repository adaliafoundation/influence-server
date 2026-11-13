require('module-alias/register');
require('dotenv').config({ silent: true });
const { mongoose } = require('@common/storage/db');
const logger = require('@common/lib/logger');

async function main() {
  await mongoose.connection.asPromise();
  for (const name of ['Claim', 'ExtractorSlots', 'ProspectingOrigin', 'ProspectingCampaign', 'ProspectingCore']) {
    await mongoose.model(`${name}Component`).createIndexes();
    logger.info(`Created indexes for ${name}`);
  }
}

main()
  .catch((error) => { logger.error(error); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
