const { expect } = require('chai');
const sinon = require('sinon');
const mongoose = require('mongoose');
const {
  TOKEN, WRONG_TOKEN,
  CREW_1, CREW_2, ASTEROID_1, WAREHOUSE, SHIP_1, SPACEPORT,
  buildActionServer, postAction, applyStubs,
  resetSeedData, createSampledDeposit
} = require('@test/helpers/actionTestHelper');

describe('Actions – Miscellaneous', function () {
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
  //  Group: Name & Annotations
  // ═══════════════════════════════════════════════════════════════

  describe('ChangeName', function () {
    it('renames an entity and writes NameComponent', async function () {
      const res = await postAction(server, TOKEN, 'ChangeName', {
        caller_crew: CREW_1,
        entity: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        name: 'My Warehouse'
      });

      expect(res.status).to.equal(200);

      const nameDoc = await mongoose.model('NameComponent').findOne({
        'entity.id': WAREHOUSE.id, 'entity.label': WAREHOUSE.label
      }).lean();
      expect(nameDoc).to.exist;
      expect(nameDoc.name).to.equal('My Warehouse');
    });

    it('rejects when entity is missing', async function () {
      const res = await postAction(server, TOKEN, 'ChangeName', {
        caller_crew: CREW_1,
        name: 'No Entity'
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('entity');
    });

    it('rejects when caller does not control crew', async function () {
      const res = await postAction(server, WRONG_TOKEN, 'ChangeName', {
        caller_crew: CREW_1,
        entity: { id: WAREHOUSE.id, label: WAREHOUSE.label },
        name: 'Stolen Name'
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Not authorized');
    });
  });

  describe('AnnotateEvent', function () {
    it('accepts a valid annotation', async function () {
      const res = await postAction(server, TOKEN, 'AnnotateEvent', {
        caller_crew: CREW_1,
        transaction_hash: '0xabc123',
        log_index: 0,
        content_hash: '0xdef456'
      });

      expect(res.status).to.equal(200);
    });

    it('rejects when transaction_hash is missing', async function () {
      const res = await postAction(server, TOKEN, 'AnnotateEvent', {
        caller_crew: CREW_1,
        content_hash: '0xdef456'
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('transaction_hash');
    });

    it('rejects when caller does not control crew', async function () {
      const res = await postAction(server, WRONG_TOKEN, 'AnnotateEvent', {
        caller_crew: CREW_1,
        transaction_hash: '0xabc123'
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Not authorized');
    });
  });

  describe('DirectMessage', function () {
    it('accepts a valid direct message', async function () {
      const res = await postAction(server, TOKEN, 'DirectMessage', {
        recipient: '0x0999999999999999999999999999999999999999999999999999999999999999',
        content_hash: '0xmessagehash'
      });

      expect(res.status).to.equal(200);
    });

    it('rejects when recipient is missing', async function () {
      const res = await postAction(server, TOKEN, 'DirectMessage', {
        content_hash: '0xmessagehash'
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('recipient');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  Group: Emergency
  // ═══════════════════════════════════════════════════════════════

  describe('Emergency actions', function () {
    before(async function () {
      // Move CREW_1 onto SHIP_1 so emergency validations pass
      await mongoose.model('LocationComponent').updateOne(
        { 'entity.id': CREW_1.id, 'entity.label': 1 },
        { $set: { 'location.id': SHIP_1.id, 'location.label': 6 } }
      );
    });

    after(async function () {
      // Restore crew location to original seed state
      await resetSeedData();
    });

    describe('ActivateEmergency', function () {
      it('activates emergency when crew is on a ship', async function () {
        const res = await postAction(server, TOKEN, 'ActivateEmergency', {
          caller_crew: CREW_1
        });

        expect(res.status).to.equal(200);
      });

      it('rejects when caller does not control crew', async function () {
        const res = await postAction(server, WRONG_TOKEN, 'ActivateEmergency', {
          caller_crew: CREW_1
        });

        expect(res.status).to.equal(400);
        expect(res.body.error).to.include('Not authorized');
      });
    });

    describe('DeactivateEmergency', function () {
      it('deactivates emergency when crew is on a ship', async function () {
        const res = await postAction(server, TOKEN, 'DeactivateEmergency', {
          caller_crew: CREW_1
        });

        expect(res.status).to.equal(200);
      });

      it('rejects when caller does not control crew', async function () {
        const res = await postAction(server, WRONG_TOKEN, 'DeactivateEmergency', {
          caller_crew: CREW_1
        });

        expect(res.status).to.equal(400);
        expect(res.body.error).to.include('Not authorized');
      });
    });

    describe('CollectEmergencyPropellant', function () {
      it('collects propellant when crew is on a ship', async function () {
        const res = await postAction(server, TOKEN, 'CollectEmergencyPropellant', {
          caller_crew: CREW_1,
          amount: 100
        });

        expect(res.status).to.equal(200);
      });

      it('rejects when caller does not control crew', async function () {
        const res = await postAction(server, WRONG_TOKEN, 'CollectEmergencyPropellant', {
          caller_crew: CREW_1,
          amount: 100
        });

        expect(res.status).to.equal(400);
        expect(res.body.error).to.include('Not authorized');
      });
    });
  });

  describe('Emergency actions – crew not on ship', function () {
    // Seed data has crew on a building/asteroid, not a ship

    it('ActivateEmergency rejects when crew is not on a ship', async function () {
      const res = await postAction(server, TOKEN, 'ActivateEmergency', {
        caller_crew: CREW_1
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('not on a ship');
    });

    it('DeactivateEmergency rejects when crew is not on a ship', async function () {
      const res = await postAction(server, TOKEN, 'DeactivateEmergency', {
        caller_crew: CREW_1
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('not on a ship');
    });

    it('CollectEmergencyPropellant rejects when crew is not on a ship', async function () {
      const res = await postAction(server, TOKEN, 'CollectEmergencyPropellant', {
        caller_crew: CREW_1,
        amount: 50
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('not on a ship');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  Group: Asteroid management
  // ═══════════════════════════════════════════════════════════════

  describe('InitializeAsteroid', function () {
    it('initializes an asteroid', async function () {
      const res = await postAction(server, TOKEN, 'InitializeAsteroid', {
        asteroid: { id: ASTEROID_1.id }
      });

      expect(res.status).to.equal(200);
    });

    it('rejects when asteroid id is missing', async function () {
      const res = await postAction(server, TOKEN, 'InitializeAsteroid', {
        asteroid: {}
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('asteroid');
    });
  });

  describe('ManageAsteroid', function () {
    it('accepts a valid manage asteroid request', async function () {
      // Use CREW_2 for asteroid 2 since CREW_1 already manages it in seed data
      const res = await postAction(server, TOKEN, 'ManageAsteroid', {
        caller_crew: CREW_2,
        asteroid: { id: 2 }
      });

      expect(res.status).to.equal(200);
    });

    it('rejects when caller does not control crew', async function () {
      const res = await postAction(server, WRONG_TOKEN, 'ManageAsteroid', {
        caller_crew: CREW_1,
        asteroid: { id: 2 }
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Not authorized');
    });

    it('rejects when asteroid id is missing', async function () {
      const res = await postAction(server, TOKEN, 'ManageAsteroid', {
        caller_crew: CREW_1,
        asteroid: {}
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('asteroid');
    });
  });

  describe('PurchaseAsteroid', function () {
    it('accepts a valid purchase asteroid request', async function () {
      // Primary-sale semantics: seed an UNOWNED asteroid (has Celestial
      // but no Nft yet). Seeded asteroids 1–2 are owned in resetSeedData
      // so the handler's "already owned" check would reject them.
      const freshId = 777;
      const freshRef = { id: freshId, label: 3 };
      await mongoose.model('Entity').updateOne(
        { uuid: require('@common/lib/Entity').toUuid(freshId, 3) },
        { $setOnInsert: { id: freshId, label: 3, uuid: require('@common/lib/Entity').toUuid(freshId, 3) } },
        { upsert: true }
      );
      await mongoose.model('CelestialComponent').findOneAndUpdate(
        { 'entity.id': freshId, 'entity.label': 3 },
        { entity: freshRef, celestialType: 1, mass: 1e9, radius: 100, scanStatus: 0 },
        { upsert: true, new: true }
      );

      const res = await postAction(server, TOKEN, 'PurchaseAsteroid', {
        caller_crew: CREW_1,
        asteroid: freshRef
      });

      expect(res.status).to.equal(200);

      // Cleanup so later tests don't see the minted asteroid.
      await mongoose.model('NftComponent').deleteOne({ 'entity.id': freshId, 'entity.label': 3 });
      await mongoose.model('CelestialComponent').deleteOne({ 'entity.id': freshId, 'entity.label': 3 });
      await mongoose.model('ControlComponent').deleteOne({ 'entity.id': freshId, 'entity.label': 3 });
      await mongoose.model('Entity').deleteOne({ id: freshId, label: 3 });
    });

    it('rejects when caller does not control crew', async function () {
      const res = await postAction(server, WRONG_TOKEN, 'PurchaseAsteroid', {
        caller_crew: CREW_1,
        asteroid: { id: ASTEROID_1.id }
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Not authorized');
    });

  });

  // ═══════════════════════════════════════════════════════════════
  //  Group: Deposit sales
  // ═══════════════════════════════════════════════════════════════

  describe('ListDepositForSale', function () {
    it('lists a deposit for sale and writes PrivateSaleComponent', async function () {
      const deposit = await createSampledDeposit(900, { resource: 1, remainingYield: 5000 });

      const res = await postAction(server, TOKEN, 'ListDepositForSale', {
        caller_crew: CREW_1,
        deposit: { id: deposit.id },
        price: 1000
      });

      expect(res.status).to.equal(200);

      const sale = await mongoose.model('PrivateSaleComponent').findOne({
        'entity.id': deposit.id, 'entity.label': 7
      }).lean();
      expect(sale).to.exist;
      expect(sale.status).to.equal(1);
      expect(sale.amount).to.equal(1000);
    });

    it('rejects when caller does not control crew', async function () {
      const deposit = await createSampledDeposit(901, { resource: 1, remainingYield: 5000 });

      const res = await postAction(server, WRONG_TOKEN, 'ListDepositForSale', {
        caller_crew: CREW_1,
        deposit: { id: deposit.id },
        price: 500
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Not authorized');
    });

    it('rejects when price is missing', async function () {
      const deposit = await createSampledDeposit(902, { resource: 1, remainingYield: 5000 });

      const res = await postAction(server, TOKEN, 'ListDepositForSale', {
        caller_crew: CREW_1,
        deposit: { id: deposit.id }
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('price');
    });
  });

  describe('UnlistDepositForSale', function () {
    it('unlists a deposit and resets PrivateSaleComponent', async function () {
      const deposit = await createSampledDeposit(910, { resource: 1, remainingYield: 5000 });

      // First list it
      await postAction(server, TOKEN, 'ListDepositForSale', {
        caller_crew: CREW_1,
        deposit: { id: deposit.id },
        price: 2000
      });

      // Then unlist
      const res = await postAction(server, TOKEN, 'UnlistDepositForSale', {
        caller_crew: CREW_1,
        deposit: { id: deposit.id }
      });

      expect(res.status).to.equal(200);

      const sale = await mongoose.model('PrivateSaleComponent').findOne({
        'entity.id': deposit.id, 'entity.label': 7
      }).lean();
      expect(sale).to.exist;
      expect(sale.status).to.equal(0);
      expect(sale.amount).to.equal(0);
    });

    it('rejects when caller does not control crew', async function () {
      const deposit = await createSampledDeposit(911, { resource: 1, remainingYield: 5000 });

      const res = await postAction(server, WRONG_TOKEN, 'UnlistDepositForSale', {
        caller_crew: CREW_1,
        deposit: { id: deposit.id }
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Not authorized');
    });

  });

  describe('PurchaseDeposit', function () {
    it('purchases a listed deposit and clears PrivateSaleComponent', async function () {
      // Seller = CREW_2, buyer = CREW_1. You can't purchase your own
      // deposit, so they must be distinct crews.
      const deposit = await createSampledDeposit(920, {
        resource: 1, remainingYield: 5000, controllerCrew: CREW_2
      });

      // CREW_2 lists it for sale
      await postAction(server, TOKEN, 'ListDepositForSale', {
        caller_crew: CREW_2,
        deposit: { id: deposit.id },
        price: 3000
      });

      // CREW_1 purchases it
      const res = await postAction(server, TOKEN, 'PurchaseDeposit', {
        caller_crew: CREW_1,
        deposit: { id: deposit.id }
      });

      expect(res.status).to.equal(200);

      const sale = await mongoose.model('PrivateSaleComponent').findOne({
        'entity.id': deposit.id, 'entity.label': 7
      }).lean();
      expect(sale).to.exist;
      expect(sale.status).to.equal(0);
      expect(sale.amount).to.equal(0);
    });

    it('rejects when caller does not control crew', async function () {
      const deposit = await createSampledDeposit(921, { resource: 1, remainingYield: 5000 });

      const res = await postAction(server, WRONG_TOKEN, 'PurchaseDeposit', {
        caller_crew: CREW_1,
        deposit: { id: deposit.id }
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Not authorized');
    });

  });

  // ═══════════════════════════════════════════════════════════════
  //  Group: Building & events
  // ═══════════════════════════════════════════════════════════════

  describe('RepossessBuilding', function () {
    it('accepts a valid repossess building request', async function () {
      const res = await postAction(server, TOKEN, 'RepossessBuilding', {
        caller_crew: CREW_1,
        building: { id: WAREHOUSE.id }
      });

      expect(res.status).to.equal(200);
    });

    it('rejects when caller does not control crew', async function () {
      const res = await postAction(server, WRONG_TOKEN, 'RepossessBuilding', {
        caller_crew: CREW_1,
        building: { id: WAREHOUSE.id }
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Not authorized');
    });

  });

  describe('ResolveRandomEvent', function () {
    it('accepts a valid random event resolution', async function () {
      const res = await postAction(server, TOKEN, 'ResolveRandomEvent', {
        caller_crew: CREW_1,
        choice: 1,
        random_event: 42,
        action_type: 1,
        action_target: { id: 1, label: 5 }
      });

      expect(res.status).to.equal(200);
    });

    it('rejects when choice is missing', async function () {
      const res = await postAction(server, TOKEN, 'ResolveRandomEvent', {
        caller_crew: CREW_1
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('choice');
    });

    it('rejects when caller does not control crew', async function () {
      const res = await postAction(server, WRONG_TOKEN, 'ResolveRandomEvent', {
        caller_crew: CREW_1,
        choice: 1
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Not authorized');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  Group: Messaging
  // ═══════════════════════════════════════════════════════════════

  describe('RekeyInbox', function () {
    it('accepts valid messaging keys', async function () {
      const res = await postAction(server, TOKEN, 'RekeyInbox', {
        x: '0xaabbccdd',
        y: '0x11223344'
      });

      expect(res.status).to.equal(200);
    });

    it('rejects when messaging keys are missing', async function () {
      const res = await postAction(server, TOKEN, 'RekeyInbox', {
        y: '0x11223344'
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('messaging keys');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  Group: Rewards
  // ═══════════════════════════════════════════════════════════════

  describe('ClaimPrepareForLaunchReward', function () {
    it('accepts a valid claim request', async function () {
      const res = await postAction(server, TOKEN, 'ClaimPrepareForLaunchReward', {
        asteroid: { id: ASTEROID_1.id }
      });

      expect(res.status).to.equal(200);
    });

    it('rejects when asteroid id is missing', async function () {
      const res = await postAction(server, TOKEN, 'ClaimPrepareForLaunchReward', {
        asteroid: {}
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('asteroid');
    });
  });
});
