const cache = require('../src/common/lib/cache');

const logger = console;
const done = function (error) {
  if (error) logger.error(error);
  logger.info('done');
  process.exit();
};

const main = async function () {
  if (process.env.NODE_ENV !== 'development') return;
  await cache.clear();
  return;
}

main()
  .then(() => done())
  .catch(done);
