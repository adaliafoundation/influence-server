const ratelimit = require('koa-ratelimit');
const { isWhiteList } = require('./origin');

module.exports = () => ratelimit({
  driver: 'memory',
  db: new Map(),
  duration: 10000,
  errorMessage: 'API is rate-limited to 5 requests per second',
  id: (ctx) => ((ctx.state.user && ctx.state.user.sub) ? ctx.state.user.sub : ctx.ip),
  max: 50,
  // Stripe authenticates with a signature in the webhook handler, not browser headers.
  whitelist: (ctx) => (ctx.method === 'POST' && ctx.path === '/v2/stripe/webhook') || isWhiteList(ctx)
});
