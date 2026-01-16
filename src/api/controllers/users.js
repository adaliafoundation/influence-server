const appConfig = require('config');
const KoaRouter = require('@koa/router');
const cors = require('@koa/cors');
const koaJwt = require('koa-jwt');
const bodyParser = require('koa-bodyparser');
const { EthereumBlockCache, StarknetBlockCache } = require('@common/lib/cache');
const { toBoolean } = require('@common/lib/utils');
const { allowedOrigin } = require('@api/plugins/origin');
const { ActivityService, ReferralService, UserService } = require('@common/services');

// load the user from the decoded jwt address
const loadUser = async (ctx, next) => {
  const { state: { user: { sub: address } } } = ctx;
  const user = await UserService.findByAddress(address);

  if (!user) {
    ctx.status = 404;
    ctx.body = { error: `User not found for: ${address}` };
    return;
  }

  ctx.state.userDoc = user;

  await next();
};

// Returns a user's profile dependent on permissions
const getUser = async (ctx) => {
  const { state: { userDoc } } = ctx;

  const { id, ...user } = userDoc.toJSON();
  ctx.type = 'application/json';
  ctx.body = user;
};

const getInboxSeed = async function (ctx) {
  const { state: { userDoc } } = ctx;

  ctx.status = 200;
  ctx.body = userDoc.directMessagingSeed;
};

const getWatchlist = async (ctx) => {
  const { state: { userDoc } } = ctx;

  ctx.body = userDoc.watchlist;
  ctx.status = 200;
};

const watchAsteroid = async (ctx) => {
  const { params: { asteroid }, request: { body: { tags } }, state: { userDoc: user } } = ctx;

  try {
    await UserService.watchAsteroid({ asteroid, tags, user });
  } catch (error) {
    ctx.status = 409;
    return;
  }

  ctx.status = 200;
};

const unwatchAsteroid = async (ctx) => {
  const { params: { asteroid }, state: { userDoc: user } } = ctx;

  try {
    await UserService.unwatchAsteroid({ asteroid, user });
  } catch (error) {
    ctx.body = error.message;
    ctx.status = 400;
    return;
  }

  ctx.status = 200;
};

const updateWatchedAsteroid = async (ctx) => {
  const { request: { body }, state: { userDoc } } = ctx;
  try {
    UserService.updateWatchList({ body, user: userDoc });
  } catch (error) {
    ctx.status = 400;
    return;
  }
  const { id, ...user } = userDoc.toJSON();
  ctx.status = 200;
  ctx.body = user;
};

const hideActionItem = async (ctx) => {
  const { state: { userDoc }, params: { id } } = ctx;
  const actionItem = await ActivityService.findById(id);
  if (!actionItem) {
    ctx.status = 404;
    return;
  }

  await ActivityService.hideFrom({ id: actionItem.id, address: userDoc.address });

  ctx.status = 200;
};

const getActivity = async (ctx) => {
  const { state: { userDoc: { address } } } = ctx;
  const resolvedCrewId = Number(ctx.query?.crewId || ctx.get('x-crew-id'));
  if (!resolvedCrewId) ctx.throw(400, 'Missing or invalid crew id');

  const since = Number(ctx.query.since) || 0;
  const page = Number(ctx.query.page) || 1;
  const pageSize = Number(ctx.query.pageSize) || 50;
  const returnTotal = (ctx.query.returnTotal) ? !!ctx.query.returnTotal : true;
  const resolved = toBoolean(ctx.query.resolved);
  const txHash = (ctx.query.txHash) ? ctx.query.txHash.split(',') : null;
  const types = (ctx.query.types) ? ctx.query.types.split(',') : null;

  const shouldPaginate = since === 0 && !txHash;

  const { docs, totalCount } = await ActivityService.findByAddressAndCrew({
    address,
    crewId: resolvedCrewId,
    since,
    page: shouldPaginate ? page : 0,
    pageSize: shouldPaginate ? pageSize : null,
    returnTotal,
    resolved,
    txHash,
    types,
    lean: false
  });

  ctx.status = 200;
  ctx.set('Eth-Block-Number', await EthereumBlockCache.getCurrentBlockNumber());
  ctx.set('Starknet-Block-Number', await StarknetBlockCache.getCurrentBlockNumber());
  ctx.set('Total-Hits', totalCount);

  // Flag hidden docs
  ctx.body = docs.map((doc) => ({ ...doc.toJSON(), isHidden: doc.isHiddenBy(address) }));
};

const getUnresolvedActivity = async (ctx) => {
  const resolvedCrewId = Number(ctx.query?.crewId || ctx.get('x-crew-id'));
  if (!resolvedCrewId) ctx.throw(400, 'Missing or invalid crew id');
  const docs = await ActivityService.findUnresolvedForCrew(resolvedCrewId);
  ctx.body = docs;
};

const getReferralsCount = async (ctx) => {
  const { state: { userDoc: user } } = ctx;

  const count = await ReferralService.getCountByReferrer(user.address);

  ctx.type = 'application/json';
  ctx.body = count;
};

const getReferralDetails = async (ctx) => {
  const { state: { userDoc: user } } = ctx;

  const referrals = await ReferralService.find(user.address);

  ctx.type = 'application/json';
  ctx.body = referrals;
};

const updateUser = async (ctx) => {
  const { request: { body }, state: { userDoc } } = ctx;
  ctx.type = 'application/json';

  try {
    await UserService.updateByAddress({ address: userDoc.address, update: body });
  } catch (error) {
    ctx.status = 400;
    ctx.body = { error: error.message };
    return;
  }

  ctx.status = 200;
  ctx.body = userDoc.toJSON();
};

// Setup routes
const router = new KoaRouter()
  .use(koaJwt({ secret: appConfig.get('App.jwtSecret') }))
  .use(cors({ origin: allowedOrigin, exposeHeaders: ['Total-Hits', 'Eth-Block-Number', 'Starknet-Block-Number'] }))
  .use(loadUser)
  .use(bodyParser())
  .get('/v2/user', getUser)
  .patch('/v2/user', updateUser)
  .get('/v2/user/inboxseed', getInboxSeed)
  .get('/v2/user/watchlist', getWatchlist)
  .post('/v2/user/watchlist/:asteroid', watchAsteroid)
  .put('/v2/user/watchlist/:asteroid', updateWatchedAsteroid)
  .delete('/v2/user/watchlist/:asteroid', unwatchAsteroid)
  .patch('/v2/user/activity/:id/hide', hideActionItem)
  .get('/v2/user/activity/unresolved', getUnresolvedActivity)
  .get('/v2/user/activity', getActivity)
  .get('/v1/user/referrals', getReferralsCount)
  .get('/v2/user/referrals', getReferralDetails);

module.exports = router;
