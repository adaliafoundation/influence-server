const { randomUUID } = require('crypto');
const logger = require('../../common/lib/logger');

module.exports = async function (ctx, next) {
  const started = Date.now();
  const requestId = randomUUID();
  ctx.set('X-Request-ID', requestId);
  ctx.state.requestId = requestId;
  let failure;
  try {
    await next();
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    const status = failure ? (failure.status || 500) : ctx.status;
    let level = 'debug';
    if (status >= 400) level = 'warn';
    if (status >= 500) level = 'error';
    logger[level]({
      event: 'http_request',
      requestId,
      method: ctx.method,
      route: ctx._matchedRoute || 'unmatched',
      status,
      durationMs: Date.now() - started
    });
  }
};
