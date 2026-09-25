require('module-alias/register');
require('dotenv').config({ silent: true });
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const appConfig = require('config');
const logger = require('@common/lib/logger');
const { Address } = require('@influenceth/sdk');

const args = yargs(hideBin(process.argv))
  .strict()
  .option('phase', { choices: ['scan', 'apply', 'status'], demandOption: true })
  .option('job', { type: 'string', default: 'lot-tenancy-state-v2', describe: 'Persistent MongoDB checkpoint name' })
  .option('blockNumber', { type: 'number', describe: 'Defaults to the latest L1-accepted block on first scan' })
  .option('delayMs', { type: 'number', default: 100, describe: 'Pause between sequential storage reads' })
  .option('dryRun', { type: 'boolean', default: false, describe: 'Do not write backfill or business records' })
  .option('processorStopped', { type: 'boolean', default: false, describe: 'Confirm the event processor is stopped' })
  .check(({ job }) => {
    if (!/^[a-zA-Z0-9_-]+$/.test(job)) throw new Error('job must contain only letters, digits, underscores or hyphens');
    return true;
  })
  .help()
  .parse();

const main = async () => {
  /* eslint-disable global-require */
  const LotTenancyBackfill = require('@common/lib/backfills/lotTenancy');
  const { RpcProvider } = require('@common/lib/starknet/providers');
  /* eslint-enable global-require */
  const { mongoose } = require('@common/storage/db'); // eslint-disable-line global-require
  try {
    await mongoose.connection.asPromise();
    const rpcEndpoint = appConfig.get('EventRetriever.starknet.rpcProvider');
    const backfill = new LotTenancyBackfill({
      provider: new RpcProvider({ endpoint: rpcEndpoint || appConfig.get('Starknet.rpcProvider') }),
      dispatcher: Address.toStandard(appConfig.get('Contracts.starknet.dispatcher'), 'starknet')
    });
    const result = args.phase === 'status' ? await backfill.status(args.job) : await backfill[args.phase](args);
    logger.info(JSON.stringify(result));
  } finally {
    await mongoose.disconnect();
  }
};

main().then(() => process.exit(0)).catch((error) => {
  logger.error(error.message);
  process.exit(1);
});
