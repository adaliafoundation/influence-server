const { expect } = require('chai');
const sinon = require('sinon');
const mongoose = require('mongoose');
const { Permission } = require('@influenceth/sdk');
const {
  TOKEN, WRONG_TOKEN,
  CREW_1, CREW_2, WAREHOUSE, EMPTY_LOT,
  buildActionServer, postAction, applyStubs,
  resetSeedData, createPrepaidPolicy, createContractPolicy
} = require('@test/helpers/actionTestHelper');

describe('Actions – Agreements & Permissions', function () {
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
  //  Policy assignment
  // ═══════════════════════════════════════════════════════════════

  describe('Policy assignment', function () {

    // ─── AssignPublicPolicy ──────────────────────────────────────

    describe('AssignPublicPolicy', function () {
      it('assigns a public policy to a target entity', async function () {
        const res = await postAction(server, TOKEN, 'AssignPublicPolicy', {
          caller_crew: CREW_1,
          target: WAREHOUSE,
          permission: Permission.IDS.USE_LOT
        });

        expect(res.status).to.equal(200);
        expect(res.body).to.have.property('event');
      });

      it('rejects when caller does not own the crew', async function () {
        const res = await postAction(server, WRONG_TOKEN, 'AssignPublicPolicy', {
          caller_crew: CREW_1,
          target: WAREHOUSE,
          permission: Permission.IDS.USE_LOT
        });

        expect(res.status).to.equal(400);
        expect(res.body.error).to.include('Not authorized');
      });

      it('rejects when permission is missing', async function () {
        const res = await postAction(server, TOKEN, 'AssignPublicPolicy', {
          caller_crew: CREW_1,
          target: WAREHOUSE
        });

        expect(res.status).to.equal(400);
        expect(res.body.error).to.include('permission');
      });
    });

    // ─── RemovePublicPolicy ─────────────────────────────────────

    describe('RemovePublicPolicy', function () {
      it('removes a public policy from a target entity', async function () {
        const res = await postAction(server, TOKEN, 'RemovePublicPolicy', {
          caller_crew: CREW_1,
          target: WAREHOUSE,
          permission: Permission.IDS.USE_LOT
        });

        expect(res.status).to.equal(200);
        expect(res.body).to.have.property('event');
      });

      it('rejects when caller does not own the crew', async function () {
        const res = await postAction(server, WRONG_TOKEN, 'RemovePublicPolicy', {
          caller_crew: CREW_1,
          target: WAREHOUSE,
          permission: Permission.IDS.USE_LOT
        });

        expect(res.status).to.equal(400);
        expect(res.body.error).to.include('Not authorized');
      });
    });

    // ─── AssignPrepaidPolicy ────────────────────────────────────

    describe('AssignPrepaidPolicy', function () {
      it('assigns a prepaid policy with rate and term', async function () {
        const res = await postAction(server, TOKEN, 'AssignPrepaidPolicy', {
          caller_crew: CREW_1,
          target: WAREHOUSE,
          permission: Permission.IDS.ADD_PRODUCTS,
          rate: 100,
          initial_term: 86400,
          notice_period: 3600
        });

        expect(res.status).to.equal(200);
        expect(res.body).to.have.property('event');
      });

      it('rejects when caller does not own the crew', async function () {
        const res = await postAction(server, WRONG_TOKEN, 'AssignPrepaidPolicy', {
          caller_crew: CREW_1,
          target: WAREHOUSE,
          permission: Permission.IDS.ADD_PRODUCTS,
          rate: 100,
          initial_term: 86400,
          notice_period: 3600
        });

        expect(res.status).to.equal(400);
        expect(res.body.error).to.include('Not authorized');
      });
    });

    // ─── RemovePrepaidPolicy ────────────────────────────────────

    describe('RemovePrepaidPolicy', function () {
      it('removes a prepaid policy from a target entity', async function () {
        const res = await postAction(server, TOKEN, 'RemovePrepaidPolicy', {
          caller_crew: CREW_1,
          target: WAREHOUSE,
          permission: Permission.IDS.ADD_PRODUCTS
        });

        expect(res.status).to.equal(200);
        expect(res.body).to.have.property('event');
      });

      it('rejects when caller does not own the crew', async function () {
        const res = await postAction(server, WRONG_TOKEN, 'RemovePrepaidPolicy', {
          caller_crew: CREW_1,
          target: WAREHOUSE,
          permission: Permission.IDS.ADD_PRODUCTS
        });

        expect(res.status).to.equal(400);
        expect(res.body.error).to.include('Not authorized');
      });
    });

    // ─── AssignContractPolicy ───────────────────────────────────

    describe('AssignContractPolicy', function () {
      it('assigns a contract policy to a target entity', async function () {
        const res = await postAction(server, TOKEN, 'AssignContractPolicy', {
          caller_crew: CREW_1,
          target: WAREHOUSE,
          permission: Permission.IDS.RUN_PROCESS,
          contract: '0x0123456789abcdef'
        });

        expect(res.status).to.equal(200);
        expect(res.body).to.have.property('event');
      });

      it('rejects when caller does not own the crew', async function () {
        const res = await postAction(server, WRONG_TOKEN, 'AssignContractPolicy', {
          caller_crew: CREW_1,
          target: WAREHOUSE,
          permission: Permission.IDS.RUN_PROCESS,
          contract: '0x0123456789abcdef'
        });

        expect(res.status).to.equal(400);
        expect(res.body.error).to.include('Not authorized');
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  Prepaid agreements
  // ═══════════════════════════════════════════════════════════════

  describe('Prepaid agreements', function () {

    // ─── AcceptPrepaidAgreement ──────────────────────────────────

    describe('AcceptPrepaidAgreement', function () {
      it('accepts a prepaid agreement when policy exists on target', async function () {
        await createPrepaidPolicy(WAREHOUSE.id, WAREHOUSE.label, {
          permission: Permission.IDS.ADD_PRODUCTS,
          rate: 100,
          initialTerm: 86400,
          noticePeriod: 3600
        });

        const res = await postAction(server, TOKEN, 'AcceptPrepaidAgreement', {
          caller_crew: CREW_1,
          target: WAREHOUSE,
          permission: Permission.IDS.ADD_PRODUCTS
        });

        expect(res.status).to.equal(200);
        expect(res.body).to.have.property('event');

        // Verify DB: PrepaidAgreementComponent was created
        const agreement = await mongoose.model('PrepaidAgreementComponent').findOne({
          'entity.id': WAREHOUSE.id,
          'entity.label': WAREHOUSE.label,
          permission: Permission.IDS.ADD_PRODUCTS
        }).lean();
        expect(agreement).to.exist;
        expect(agreement.rate).to.equal(100);
        expect(agreement.initialTerm).to.equal(86400);
        expect(agreement.noticePeriod).to.equal(3600);

        // Cleanup
        await mongoose.model('PrepaidAgreementComponent').deleteMany({
          'entity.id': WAREHOUSE.id, 'entity.label': WAREHOUSE.label
        });
        await mongoose.model('PrepaidPolicyComponent').deleteMany({
          'entity.id': WAREHOUSE.id, 'entity.label': WAREHOUSE.label
        });
      });

      it('rejects when caller does not own the crew', async function () {
        const res = await postAction(server, WRONG_TOKEN, 'AcceptPrepaidAgreement', {
          caller_crew: CREW_1,
          target: WAREHOUSE,
          permission: Permission.IDS.ADD_PRODUCTS
        });

        expect(res.status).to.equal(400);
        expect(res.body.error).to.include('Not authorized');
      });
    });

    // ─── ExtendPrepaidAgreement ─────────────────────────────────

    describe('ExtendPrepaidAgreement', function () {
      it('extends an existing prepaid agreement', async function () {
        const now = Math.floor(Date.now() / 1000);

        // Create a PrepaidAgreement directly in DB
        await mongoose.model('PrepaidAgreementComponent').findOneAndUpdate(
          {
            'entity.id': WAREHOUSE.id,
            'entity.label': WAREHOUSE.label,
            permission: Permission.IDS.REMOVE_PRODUCTS,
            'permitted.id': CREW_1.id
          },
          {
            entity: { id: WAREHOUSE.id, label: WAREHOUSE.label },
            permission: Permission.IDS.REMOVE_PRODUCTS,
            permitted: CREW_1,
            rate: 50,
            initialTerm: 86400,
            noticePeriod: 1800,
            startTime: now - 1000,
            endTime: now + 86400,
            noticeTime: 0
          },
          { upsert: true, new: true }
        );

        const res = await postAction(server, TOKEN, 'ExtendPrepaidAgreement', {
          caller_crew: CREW_1,
          target: WAREHOUSE,
          permission: Permission.IDS.REMOVE_PRODUCTS,
          added_term: 43200
        });

        expect(res.status).to.equal(200);
        expect(res.body).to.have.property('event');

        // Verify DB: endTime was extended
        const agreement = await mongoose.model('PrepaidAgreementComponent').findOne({
          'entity.id': WAREHOUSE.id,
          'entity.label': WAREHOUSE.label,
          permission: Permission.IDS.REMOVE_PRODUCTS,
          'permitted.id': CREW_1.id
        }).lean();
        expect(agreement).to.exist;
        expect(agreement.endTime).to.be.greaterThan(now + 86400);

        // Cleanup
        await mongoose.model('PrepaidAgreementComponent').deleteMany({
          'entity.id': WAREHOUSE.id, 'entity.label': WAREHOUSE.label
        });
      });

      it('rejects when caller does not own the crew', async function () {
        const res = await postAction(server, WRONG_TOKEN, 'ExtendPrepaidAgreement', {
          caller_crew: CREW_1,
          target: WAREHOUSE,
          permission: Permission.IDS.REMOVE_PRODUCTS,
          added_term: 43200
        });

        expect(res.status).to.equal(400);
        expect(res.body.error).to.include('Not authorized');
      });
    });

    // ─── CancelPrepaidAgreement ─────────────────────────────────

    describe('CancelPrepaidAgreement', function () {
      it('cancels a prepaid agreement', async function () {
        const res = await postAction(server, TOKEN, 'CancelPrepaidAgreement', {
          caller_crew: CREW_1,
          target: WAREHOUSE,
          permission: Permission.IDS.ADD_PRODUCTS
        });

        expect(res.status).to.equal(200);
        expect(res.body).to.have.property('event');
      });

      it('rejects when caller does not own the crew', async function () {
        const res = await postAction(server, WRONG_TOKEN, 'CancelPrepaidAgreement', {
          caller_crew: CREW_1,
          target: WAREHOUSE,
          permission: Permission.IDS.ADD_PRODUCTS
        });

        expect(res.status).to.equal(400);
        expect(res.body.error).to.include('Not authorized');
      });
    });

    // ─── TransferPrepaidAgreement ───────────────────────────────

    describe('TransferPrepaidAgreement', function () {
      it('transfers a prepaid agreement to a new permitted entity', async function () {
        // Seed an existing agreement with CREW_1 as the tenant so the
        // handler has something to transfer. Without this the
        // authorization / existence check rejects — the handler now
        // enforces the old-tenant rule from Cairo transfer_prepaid.cairo.
        await mongoose.model('PrepaidAgreementComponent').findOneAndUpdate(
          { 'entity.id': WAREHOUSE.id, 'entity.label': WAREHOUSE.label,
            permission: Permission.IDS.ADD_PRODUCTS, 'permitted.id': CREW_1.id },
          {
            entity: { id: WAREHOUSE.id, label: WAREHOUSE.label },
            permission: Permission.IDS.ADD_PRODUCTS,
            permitted: { id: CREW_1.id, label: CREW_1.label },
            rate: 0, initialTerm: 0, noticePeriod: 0,
            startTime: Math.floor(Date.now() / 1000),
            endTime: Math.floor(Date.now() / 1000) + 7 * 86400
          },
          { upsert: true, new: true }
        );

        const res = await postAction(server, TOKEN, 'TransferPrepaidAgreement', {
          caller_crew: CREW_1,
          target: WAREHOUSE,
          permission: Permission.IDS.ADD_PRODUCTS,
          new_permitted: { id: CREW_2.id }
        });

        expect(res.status).to.equal(200);
        expect(res.body).to.have.property('event');
      });

      it('rejects when caller does not own the crew', async function () {
        const res = await postAction(server, WRONG_TOKEN, 'TransferPrepaidAgreement', {
          caller_crew: CREW_1,
          target: WAREHOUSE,
          permission: Permission.IDS.ADD_PRODUCTS,
          new_permitted: { id: CREW_2.id }
        });

        expect(res.status).to.equal(400);
        expect(res.body.error).to.include('Not authorized');
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  Contract agreements
  // ═══════════════════════════════════════════════════════════════

  describe('Contract agreements', function () {

    // ─── AcceptContractAgreement ─────────────────────────────────

    describe('AcceptContractAgreement', function () {
      it('accepts a contract agreement when policy exists on target', async function () {
        await createContractPolicy(WAREHOUSE.id, WAREHOUSE.label, {
          permission: Permission.IDS.RUN_PROCESS,
          contract: '0xdeadbeef'
        });

        const res = await postAction(server, TOKEN, 'AcceptContractAgreement', {
          caller_crew: CREW_1,
          target: WAREHOUSE,
          permission: Permission.IDS.RUN_PROCESS
        });

        expect(res.status).to.equal(200);
        expect(res.body).to.have.property('event');

        // Verify DB: ContractAgreementComponent was created
        const agreement = await mongoose.model('ContractAgreementComponent').findOne({
          'entity.id': WAREHOUSE.id,
          'entity.label': WAREHOUSE.label,
          permission: Permission.IDS.RUN_PROCESS
        }).lean();
        expect(agreement).to.exist;
        expect(agreement.address).to.equal('0xdeadbeef');

        // Cleanup
        await mongoose.model('ContractAgreementComponent').deleteMany({
          'entity.id': WAREHOUSE.id, 'entity.label': WAREHOUSE.label
        });
        await mongoose.model('ContractPolicyComponent').deleteMany({
          'entity.id': WAREHOUSE.id, 'entity.label': WAREHOUSE.label
        });
      });

      it('rejects when caller does not own the crew', async function () {
        const res = await postAction(server, WRONG_TOKEN, 'AcceptContractAgreement', {
          caller_crew: CREW_1,
          target: WAREHOUSE,
          permission: Permission.IDS.RUN_PROCESS
        });

        expect(res.status).to.equal(400);
        expect(res.body.error).to.include('Not authorized');
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  Whitelisting
  // ═══════════════════════════════════════════════════════════════

  describe('Whitelisting', function () {

    // ─── Whitelist ──────────────────────────────────────────────

    describe('Whitelist', function () {
      it('whitelists a crew for a permission on a target', async function () {
        const res = await postAction(server, TOKEN, 'Whitelist', {
          caller_crew: CREW_1,
          target: WAREHOUSE,
          permission: Permission.IDS.ADD_PRODUCTS,
          permitted: { id: CREW_2.id }
        });

        expect(res.status).to.equal(200);
        expect(res.body).to.have.property('event');
      });

      it('rejects when caller does not own the crew', async function () {
        const res = await postAction(server, WRONG_TOKEN, 'Whitelist', {
          caller_crew: CREW_1,
          target: WAREHOUSE,
          permission: Permission.IDS.ADD_PRODUCTS,
          permitted: { id: CREW_2.id }
        });

        expect(res.status).to.equal(400);
        expect(res.body.error).to.include('Not authorized');
      });
    });

    // ─── RemoveFromWhitelist ────────────────────────────────────

    describe('RemoveFromWhitelist', function () {
      it('removes a crew from the whitelist', async function () {
        const res = await postAction(server, TOKEN, 'RemoveFromWhitelist', {
          caller_crew: CREW_1,
          target: WAREHOUSE,
          permission: Permission.IDS.ADD_PRODUCTS,
          permitted: { id: CREW_2.id }
        });

        expect(res.status).to.equal(200);
        expect(res.body).to.have.property('event');
      });

      it('rejects when caller does not own the crew', async function () {
        const res = await postAction(server, WRONG_TOKEN, 'RemoveFromWhitelist', {
          caller_crew: CREW_1,
          target: WAREHOUSE,
          permission: Permission.IDS.ADD_PRODUCTS,
          permitted: { id: CREW_2.id }
        });

        expect(res.status).to.equal(400);
        expect(res.body.error).to.include('Not authorized');
      });
    });

    // ─── WhitelistAccount ───────────────────────────────────────

    describe('WhitelistAccount', function () {
      it('whitelists an account address for a permission', async function () {
        const res = await postAction(server, TOKEN, 'WhitelistAccount', {
          caller_crew: CREW_1,
          target: WAREHOUSE,
          permission: Permission.IDS.ADD_PRODUCTS,
          permitted: '0x0999999999999999999999999999999999999999999999999999999999999999'
        });

        expect(res.status).to.equal(200);
        expect(res.body).to.have.property('event');
      });

      it('rejects when caller does not own the crew', async function () {
        const res = await postAction(server, WRONG_TOKEN, 'WhitelistAccount', {
          caller_crew: CREW_1,
          target: WAREHOUSE,
          permission: Permission.IDS.ADD_PRODUCTS,
          permitted: '0x0999999999999999999999999999999999999999999999999999999999999999'
        });

        expect(res.status).to.equal(400);
        expect(res.body.error).to.include('Not authorized');
      });
    });

    // ─── RemoveAccountFromWhitelist ─────────────────────────────

    describe('RemoveAccountFromWhitelist', function () {
      it('removes an account address from the whitelist', async function () {
        const res = await postAction(server, TOKEN, 'RemoveAccountFromWhitelist', {
          caller_crew: CREW_1,
          target: WAREHOUSE,
          permission: Permission.IDS.ADD_PRODUCTS,
          permitted: '0x0999999999999999999999999999999999999999999999999999999999999999'
        });

        expect(res.status).to.equal(200);
        expect(res.body).to.have.property('event');
      });

      it('rejects when caller does not own the crew', async function () {
        const res = await postAction(server, WRONG_TOKEN, 'RemoveAccountFromWhitelist', {
          caller_crew: CREW_1,
          target: WAREHOUSE,
          permission: Permission.IDS.ADD_PRODUCTS,
          permitted: '0x0999999999999999999999999999999999999999999999999999999999999999'
        });

        expect(res.status).to.equal(400);
        expect(res.body.error).to.include('Not authorized');
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  Lot management
  // ═══════════════════════════════════════════════════════════════

  describe('Lot management', function () {

    // ─── ReclaimLot ─────────────────────────────────────────────

    describe('ReclaimLot', function () {
      it('reclaims a lot', async function () {
        const res = await postAction(server, TOKEN, 'ReclaimLot', {
          caller_crew: CREW_1,
          lot: EMPTY_LOT
        });

        expect(res.status).to.equal(200);
        expect(res.body).to.have.property('event');
      });

      it('rejects when caller does not own the crew', async function () {
        const res = await postAction(server, WRONG_TOKEN, 'ReclaimLot', {
          caller_crew: CREW_1,
          lot: EMPTY_LOT
        });

        expect(res.status).to.equal(400);
        expect(res.body.error).to.include('Not authorized');
      });
    });
  });
});
