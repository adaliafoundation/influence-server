const KoaRouter = require('@koa/router');
const cors = require('@koa/cors');
const bodyParser = require('koa-bodyparser');
const { allowedOrigin } = require('@api/plugins/origin');
const Entity = require('@common/lib/Entity');
const { PackedLotDataService, PrepaidMerklePolicyService } = require('@common/services');

const addPrepaidMerkle = async (ctx) => {
  const { request: { body: { entity, merkleTree, permission } = {} } } = ctx;

  try {
    const result = await PrepaidMerklePolicyService.uploadMerkleTree({
      entity: Entity.fromUuid(entity),
      merkleTree,
      permission
    });

    // update packed data for lot(s) specified in the merkle tree, set to leaseable
    await PackedLotDataService.updateLotsToLeaseable({ asteroid: entity, lotUuids: merkleTree[0] });

    ctx.status = 200;
    ctx.body = result.toJSON();
  } catch (error) {
    ctx.status = 400;
    ctx.body = { error: error.message };
  }
};

const router = new KoaRouter()
  .use(bodyParser())
  .use(cors({ origin: allowedOrigin }))
  .patch('/v2/components/prepaidmerkle-policy/pin', addPrepaidMerkle);

module.exports = router;
