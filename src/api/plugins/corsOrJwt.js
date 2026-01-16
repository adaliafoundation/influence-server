const mongoose = require('mongoose');

// DEPRECATE: Retrieve and cache set of legacy API keys in memory
const keys = [];

// Checks that the incoming request is either a browser (CORS) request or has a valid JWT
const corsOrJwt = async (ctx, next) => {
  if (keys.length === 0) {
    const docs = await mongoose.model('ApiKey').find({ key: { $ne: null } });
    docs.reduce(((acc, { key }) => { acc.push(key); return acc; }), keys);
  }

  const key = ctx.query['api-key']; // DEPRECATE

  if (!ctx.request.headers.origin && !ctx.state.user && !keys.includes(key)) { // DEPRECATE: legacy keys check
    ctx.status = 401;
  } else {
    await next();
  }
};

module.exports = corsOrJwt;
