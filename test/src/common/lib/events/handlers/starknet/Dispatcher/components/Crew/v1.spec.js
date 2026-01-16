const { expect } = require('chai');
const mongoose = require('mongoose');
const Entity = require('@common/lib/Entity');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/components/Crew/v1');
const CrewReadyNotificationService = require('@common/services/Notifications/CrewReady');

describe('ComponentUpdated: Crew Handler (v1)', function () {
  let event;
  let crewReadyNotificationServiceStub;

  beforeEach(function () {
    event = mongoose.model('Starknet')({
      event: 'ComponentUpdated_AsteroidSale',
      logIndex: 1,
      timestamp: 1695691834,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      data: [
        '0x1',
        '0x10001',
        '0x1',
        '0x5', '0x1', '0x2', '0x3', '0x4', '0x5',
        '0x64a59467',
        `0x${(Math.floor(Date.now() / 1000) + 10000).toString(16)}`,
        '0x2',
        '0x1', '0x2',
        '0x4',
        '0x1',
        '0x1'
      ],
      returnValues: {
        entity: { label: 1, id: 1 },
        delegatedTo: '0x0000000000000000000000000000000000000000000000000000000000000001',
        roster: [1, 2, 3, 4, 5],
        lastFed: 1688573031,
        readyAt: Math.floor(Date.now() / 1000) + 10000,
        actionType: 2,
        actionTarget: { label: 1, id: 2 },
        actionRound: 4,
        actionWeight: 1,
        actionStrategy: 1
      }
    });

    crewReadyNotificationServiceStub = this._sandbox.stub(CrewReadyNotificationService, 'createOrUpdate').resolves();
  });

  afterEach(function () {
    return this.utils.resetCollections(['CrewComponent', 'CrewReadyNotification', 'Entity', 'IndexItem',
      'NftComponent']);
  });

  describe('processEvent', function () {
    it('should create/update the correct the CrewComponent document', async function () {
      await (new Handler(event)).processEvent();
      const doc = await mongoose.model('CrewComponent').findOne({ 'entity.uuid': Entity.Crew(1).uuid });
      expect(doc).to.be.an('object');
      expect(doc.lastReadyAt).to.equal(event.returnValues.readyAt);
    });

    it('should update the lastReadyAt if the new readyAt is greater than the current readyAt', async function () {
      await mongoose.model('CrewComponent').create({
        entity: Entity.Crew(1),
        readyAt: 1688573046,
        lastReadyAt: 1688573046
      });
      event.data[5] = '0x64a59480';
      event.returnValues.readyAt = 1688573056;

      await (new Handler(event)).processEvent();
      const doc = await mongoose.model('CrewComponent').findOne({ 'entity.uuid': Entity.Crew(1).uuid });
      expect(doc).to.be.an('object');
      expect(doc.readyAt).to.equal(1688573056);
      expect(doc.lastReadyAt).to.equal(1688573046);
    });

    it('should create a notification', async function () {
      await (new Handler(event)).processEvent();
      expect(crewReadyNotificationServiceStub.calledOnce).to.equal(true);
    });
  });

  describe('transformEventData', function () {
    it('should transform the data correctly', function () {
      expect(Handler.transformEventData(event)).to.deep.equal(event.returnValues);
    });
  });
});
