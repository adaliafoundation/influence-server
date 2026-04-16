const { expect } = require('chai');
const sinon = require('sinon');
const mongoose = require('mongoose');
const { Building } = require('@influenceth/sdk');
const {
  TOKEN,
  CREW_1, WAREHOUSE,
  buildActionServer, postAction, applyStubs,
  resetSeedData, setBuildingStatus
} = require('@test/helpers/actionTestHelper');

describe('Actions – Batch/Virtual actions', function () {
  let server;
  let sandbox;

  before(async function () {
    sandbox = sinon.createSandbox();
    applyStubs(sandbox);
    await resetSeedData();
    server = buildActionServer();
  });

  afterEach(function () {
    sandbox.restore();
    sandbox = sinon.createSandbox();
    applyStubs(sandbox);
  });

  after(function () {
    sandbox.restore();
  });

  // ═══════════════════════════════════════════════════════════════
  //  FinishAllReady
  // ═══════════════════════════════════════════════════════════════

  describe('FinishAllReady', function () {
    it('decomposes into individual finish calls', async function () {
      // Set warehouse to UNDER_CONSTRUCTION with past finishTime
      const pastTime = Math.floor(Date.now() / 1000) - 100;
      await setBuildingStatus(WAREHOUSE.id, Building.CONSTRUCTION_STATUSES.UNDER_CONSTRUCTION, pastTime);

      const res = await postAction(server, TOKEN, 'FinishAllReady', {
        caller_crew: CREW_1,
        finishCalls: [
          {
            key: 'ConstructionFinish',
            vars: {
              caller_crew: CREW_1,
              building: WAREHOUSE
            }
          }
        ]
      });

      expect(res.status).to.equal(200);

      // Verify: building is now OPERATIONAL
      const bldg = await mongoose.model('BuildingComponent').findOne({
        'entity.id': WAREHOUSE.id, 'entity.label': 5
      }).lean();
      expect(bldg.status).to.equal(Building.CONSTRUCTION_STATUSES.OPERATIONAL);
    });

    it('handles empty finishCalls array', async function () {
      const res = await postAction(server, TOKEN, 'FinishAllReady', {
        caller_crew: CREW_1,
        finishCalls: []
      });

      // Empty finishCalls returns empty results
      expect(res.status).to.equal(200);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  Alias actions
  // ═══════════════════════════════════════════════════════════════

  describe('Alias actions', function () {
    it('FlexibleExtractResourceStart resolves to ExtractResourceStart', async function () {
      // Should fail validation just like ExtractResourceStart would
      const res = await postAction(server, TOKEN, 'FlexibleExtractResourceStart', {
        caller_crew: CREW_1
        // missing extractor, deposit, etc.
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('extractor');
    });

    it('rejects unknown action names', async function () {
      const res = await postAction(server, TOKEN, 'CompletelyFakeAction', {
        caller_crew: CREW_1
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Unknown action');
    });
  });
});
