const appConfig = require('config');
const KoaRouter = require('@koa/router');
const koaJwt = require('koa-jwt');
const cors = require('@koa/cors');
const corsOrJwt = require('@api/plugins/corsOrJwt');
const { allowedOrigin } = require('@api/plugins/origin');
const MissionService = require('@common/services/Mission');
const { felt, subjectFromUuid } = require('@common/lib/missions');

const integer = (value, min, max) => {
  if (!/^[0-9]+$/.test(String(value))) throw new Error('Invalid integer');
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error('Integer out of range');
  return number;
};

const readInput = (ctx, read) => {
  try {
    return read();
  } catch (error) {
    return ctx.throw(400, error.message);
  }
};

const respond = (ctx, result) => {
  if (!result) ctx.throw(404, 'Mission campaign not indexed');
  ctx.body = result;
};

const router = new KoaRouter()
  .use(koaJwt({ secret: appConfig.get('App.jwtSecret'), passthrough: true }))
  .use(cors({ origin: allowedOrigin }))
  .use(corsOrJwt)
  .get('/v2/missions/starter/:crewId', async (ctx) => {
    const crewId = readInput(ctx, () => {
      const value = felt(ctx.params.crewId);
      if (BigInt(value) === 0n || BigInt(value) >= (2n ** 64n)) throw new Error('Invalid crew ID');
      return value;
    });
    ctx.body = await MissionService.getStarter(crewId);
  })
  .get('/v2/missions/campaigns/:campaign', async (ctx) => {
    const campaign = readInput(ctx, () => felt(ctx.params.campaign));
    respond(ctx, await MissionService.getCampaign(campaign));
  })
  .get('/v2/missions/campaigns/:campaign/subjects/:uuid', async (ctx) => {
    const { campaign, subject, page } = readInput(ctx, () => ({
      campaign: felt(ctx.params.campaign),
      subject: subjectFromUuid(ctx.params.uuid),
      page: integer(ctx.query.page ?? 0, 0, 0x7ffffff)
    }));
    respond(ctx, await MissionService.getSubject(campaign, subject, page));
  })
  .get('/v2/missions/campaigns/:campaign/subjects/:uuid/evidence', async (ctx) => {
    const { campaign, subject, page, pageSize } = readInput(ctx, () => ({
      campaign: felt(ctx.params.campaign),
      subject: subjectFromUuid(ctx.params.uuid),
      page: integer(ctx.query.page ?? 1, 1, 1000000),
      pageSize: integer(ctx.query.pageSize ?? 100, 1, 100)
    }));
    respond(ctx, await MissionService.getEvidence(campaign, subject, page, pageSize));
  });

module.exports = router;
