const { expect } = require('chai');
const mongoose = require('mongoose');
const Entity = require('@common/lib/Entity');
const Handler = require('@common/lib/events/handlers/ethereum/ArvadCrewSale/AsteroidUsed');

describe('ArvadCrewSale::AsteroidUsed', function () {
  let event;

  before(function () {
    event = mongoose.model('Ethereum')({
      transactionHash: '0x123',
      blockNumber: 123,
      logIndex: 0,
      event: 'AsteroidUsed',
      timestamp: 1,
      returnValues: {
        asteroidId: '1',
        crewId: '1'
      }
    });
  });

  afterEach(function () {
    return this.utils.resetCollections([
      'AsteroidRewardComponent', 'Entity', 'Event', 'CrewmateRewardComponent', 'CrewmateComponent', 'IndexItem'
    ]);
  });

  describe('processEvent', function () {
    let handler;
    let stub;

    beforeEach(function () {
      handler = new Handler(event);
      stub = this._sandbox.stub(handler, '_getFeaturesAndAppearance').resolves({
        appearance: '0x123',
        features: { class: 1, coll: 1, title: 1 }
      });
    });

    it('should create/update the Crewmate Component document', async function () {
      await handler.processEvent();
      expect(stub.calledOnceWith('1')).to.equal(true);
      const crewmateCompDoc = await mongoose.model('CrewmateComponent').findOne({
        'entity.uuid': Entity.Crewmate(1).uuid
      });
      expect(crewmateCompDoc.appearance).to.equal('0x123');
      expect(crewmateCompDoc.class).to.equal(1);
      expect(crewmateCompDoc.coll).to.equal(1);
      expect(crewmateCompDoc.title).to.equal(1);
    });

    it('should create/update the AsteroidReward Component document', async function () {
      await handler.processEvent();
      const asteroidRewardCompDoc = await mongoose.model('AsteroidRewardComponent')
        .findOne({ entity: { id: 1, label: 3 } });
      expect(asteroidRewardCompDoc.hasMintableCrewmate).to.equal(false);
    });

    it('should queue the Asteroid and Crewmate entities for indexing', async function () {
      await handler.processEvent();
      const docs = await mongoose.model('IndexItem').find({
        model: 'Entity',
        identifier: { $in: [{ uuid: '0x10002' }, { uuid: '0x10003' }] }
      })
        .lean();
      expect(docs).to.have.lengthOf(2);
    });
  });
});
