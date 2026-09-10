require('module-alias/register');
require('dotenv').config({ silent: true });
const { randomUUID } = require('node:crypto');
const { open, unlink } = require('node:fs/promises');
const mongoose = require('mongoose');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const { apiKey } = require('@common/lib/hash');
const logger = require('@common/lib/logger');

async function generateApiKey({ name, output }) {
  if (!name || !output) throw new Error('Name and output file are required');
  const clientId = randomUUID();
  const secret = randomUUID();
  // Reserve a private, new file before creating a database credential; never overwrite a secret.
  const file = await open(output, 'wx', 0o600);
  try {
    await file.writeFile(`${JSON.stringify({ name, client_id: clientId, client_secret: secret }, null, 2)}\n`);
    await mongoose.model('ApiKey').create({ name, client_id: clientId, client_secret: apiKey.generateHash(secret) });
  } catch (error) {
    await unlink(output);
    throw error;
  } finally {
    await file.close();
  }
}

if (require.main === module) {
  const args = yargs(hideBin(process.argv))
    .option('name', { alias: 'n', type: 'string', demandOption: true })
    .option('output', {
      alias: 'o',
      type: 'string',
      demandOption: true,
      description: 'New private JSON file for the client ID and secret (must not already exist)' })
    .strict()
    .help()
    .parse();

  require('@common/storage/db'); // eslint-disable-line global-require
  generateApiKey(args)
    .then(() => logger.info('API credentials created and written to the requested private file'))
    .catch((error) => {
      logger.error(error);
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}

module.exports = generateApiKey;
