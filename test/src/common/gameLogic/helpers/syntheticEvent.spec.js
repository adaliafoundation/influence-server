const { expect } = require('chai');
const SyntheticEvent = require('@common/gameLogic/helpers/syntheticEvent');

describe('SyntheticEvent', function () {
  afterEach(function () {
    return this.utils.resetCollections(['Starknet']);
  });

  describe('create()', function () {
    it('should create a valid Starknet event document', async function () {
      const event = await SyntheticEvent.create({
        eventName: 'ConstructionPlanned',
        returnValues: { building: 1, buildingType: 2 }
      });

      expect(event).to.not.equal(null);
      expect(event.event).to.equal('ConstructionPlanned');
      expect(event.name).to.equal('ConstructionPlanned');
      expect(event.status).to.equal('ACCEPTED_ON_L2');
      expect(event.address).to.equal('local-hybrid-server');
      expect(event.returnValues.building).to.equal(1);
    });

    it('should use block numbers above 9 billion offset', async function () {
      const event = await SyntheticEvent.create({
        eventName: 'ConstructionPlanned',
        returnValues: {}
      });

      expect(event.blockNumber).to.be.above(9_000_000_000);
    });

    it('should increment block numbers across calls', async function () {
      const event1 = await SyntheticEvent.create({
        eventName: 'ConstructionPlanned',
        returnValues: {}
      });
      const event2 = await SyntheticEvent.create({
        eventName: 'ConstructionPlanned',
        returnValues: {}
      });

      expect(event2.blockNumber).to.be.above(event1.blockNumber);
    });

    it('should generate a transaction hash when not provided', async function () {
      const event = await SyntheticEvent.create({
        eventName: 'ConstructionPlanned',
        returnValues: {}
      });

      expect(event.transactionHash).to.match(/^0x[0-9a-f]+$/);
    });

    it('should use provided transaction hash', async function () {
      const txHash = '0xabc123';
      const event = await SyntheticEvent.create({
        eventName: 'ConstructionPlanned',
        returnValues: {},
        transactionHash: txHash
      });

      // The hash may be padded/normalized by the schema (e.g. Address.toStandard)
      expect(event.transactionHash).to.include('abc123');
    });

    it('should store idempotency key in returnValues', async function () {
      const key = 'test-key-123';
      const event = await SyntheticEvent.create({
        eventName: 'ConstructionPlanned',
        returnValues: { building: 1 },
        idempotencyKey: key
      });

      expect(event.returnValues.idempotencyKey).to.equal(key);
    });

    it('should populate keys from Dispatcher handler for known events', async function () {
      const event = await SyntheticEvent.create({
        eventName: 'ConstructionPlanned',
        returnValues: {}
      });

      // ConstructionPlanned is a real Dispatcher system handler, so keys should be populated
      expect(event.keys).to.be.an('array');
      expect(event.keys.length).to.be.above(0);
    });

    it('should fall back to empty keys for unknown events', async function () {
      const event = await SyntheticEvent.create({
        eventName: 'CompletelyFakeEvent',
        returnValues: {}
      });

      expect(event.keys).to.be.an('array');
      expect(event.keys).to.have.lengthOf(0);
    });

    it('should set lastProcessed so EventProcessor skips it', async function () {
      const event = await SyntheticEvent.create({
        eventName: 'ConstructionPlanned',
        returnValues: {}
      });

      expect(event.lastProcessed).to.be.an.instanceof(Date);
    });
  });

  describe('createComponentEvent()', function () {
    it('should share parent event block and transaction', async function () {
      const parent = await SyntheticEvent.create({
        eventName: 'ConstructionPlanned',
        returnValues: {}
      });

      const child = await SyntheticEvent.createComponentEvent({
        parentEvent: parent,
        componentName: 'Building',
        returnValues: { buildingType: 1 }
      });

      expect(child.blockNumber).to.equal(parent.blockNumber);
      expect(child.transactionHash).to.equal(parent.transactionHash);
      expect(child.transactionIndex).to.equal(parent.transactionIndex);
    });

    it('should have a higher logIndex than parent', async function () {
      const parent = await SyntheticEvent.create({
        eventName: 'ConstructionPlanned',
        returnValues: {}
      });

      const child = await SyntheticEvent.createComponentEvent({
        parentEvent: parent,
        componentName: 'Building',
        returnValues: {}
      });

      expect(child.logIndex).to.be.above(parent.logIndex);
    });

    it('should use ComponentUpdated_ prefix for event name', async function () {
      const parent = await SyntheticEvent.create({
        eventName: 'ConstructionPlanned',
        returnValues: {}
      });

      const child = await SyntheticEvent.createComponentEvent({
        parentEvent: parent,
        componentName: 'Location',
        returnValues: {}
      });

      expect(child.event).to.equal('ComponentUpdated_Location');
    });
  });

  describe('findByIdempotencyKey()', function () {
    it('should find an event by its idempotency key', async function () {
      const key = 'unique-key-456';
      await SyntheticEvent.create({
        eventName: 'ConstructionPlanned',
        returnValues: { building: 42 },
        idempotencyKey: key
      });

      const found = await SyntheticEvent.findByIdempotencyKey(key);
      expect(found).to.not.equal(null);
      expect(found.returnValues.building).to.equal(42);
    });

    it('should return null for unknown key', async function () {
      const found = await SyntheticEvent.findByIdempotencyKey('nonexistent');
      expect(found).to.equal(null);
    });

    it('should return null when key is falsy', async function () {
      const found = await SyntheticEvent.findByIdempotencyKey(null);
      expect(found).to.equal(null);
    });
  });

  describe('transactional writes', function () {
    it('should persist event when session transaction is committed', async function () {
      const session = await mongoose.startSession();
      session.startTransaction();

      const event = await SyntheticEvent.create({
        eventName: 'ConstructionPlanned',
        returnValues: { building: 99 },
        session
      });

      await session.commitTransaction();
      session.endSession();

      const found = await mongoose.model('Starknet').findById(event._id).lean();
      expect(found).to.not.equal(null);
      expect(found.returnValues.building).to.equal(99);
    });

    it('should discard event when session transaction is aborted', async function () {
      const session = await mongoose.startSession();
      session.startTransaction();

      const event = await SyntheticEvent.create({
        eventName: 'ConstructionPlanned',
        returnValues: { building: 100 },
        session
      });

      await session.abortTransaction();
      session.endSession();

      const found = await mongoose.model('Starknet').findById(event._id).lean();
      expect(found).to.equal(null);
    });

    it('should discard component events when session transaction is aborted', async function () {
      const session = await mongoose.startSession();
      session.startTransaction();

      const parent = await SyntheticEvent.create({
        eventName: 'ConstructionPlanned',
        returnValues: {},
        session
      });

      const child = await SyntheticEvent.createComponentEvent({
        parentEvent: parent,
        componentName: 'Building',
        returnValues: { buildingType: 1 },
        session
      });

      await session.abortTransaction();
      session.endSession();

      const foundParent = await mongoose.model('Starknet').findById(parent._id).lean();
      const foundChild = await mongoose.model('Starknet').findById(child._id).lean();
      expect(foundParent).to.equal(null);
      expect(foundChild).to.equal(null);
    });
  });
});
