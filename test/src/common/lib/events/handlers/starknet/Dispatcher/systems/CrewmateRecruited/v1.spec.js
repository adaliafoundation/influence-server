const { expect } = require('chai');
const mongoose = require('mongoose');
const { OpenSea, Unframed } = require('@common/lib/marketplaces');
const Entity = require('@common/lib/Entity');
const { PackedLotDataService } = require('@common/services');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/systems/CrewmateRecruited/v1');

describe('CrewmateRecruited (v1) Handler', function () {
  let event;
  const stubs = {
    updateLotCrewStatus: null
  };

  beforeEach(function () {
    event = mongoose.model('Starknet')({
      event: 'CrewmateRecruitedV1',
      logIndex: 1,
      timestamp: 1695691834,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      data: [
        '0x1', '0x2',
        '0x1',
        '0x1',
        '0x1',
        '0x3', '0x1', '0x2', '0x3',
        '0x3', '0x1', '0x2', '0x3',
        '0x1',
        '0x1',
        '0x1',
        '0x1',
        '0x1',
        '0x1',
        '0x1',
        '0x1',
        '0x5465737443726577',
        '0x5', '0x1',
        '0x3', '0x1', '0x2', '0x3',
        '0x1', '0x1',
        '0x123456789'
      ],
      returnValues: {
        crewmate: { id: 2, label: 1 },
        coll: 1,
        class: 1,
        title: 1,
        impactful: [1, 2, 3],
        cosmetic: [1, 2, 3],
        gender: 1,
        body: 1,
        face: 1,
        hair: 1,
        hairColor: 1,
        clothes: 1,
        head: 1,
        item: 1,
        name: 'TestCrew',
        station: { id: 1, label: 5 },
        composition: [1, 2, 3],
        callerCrew: { id: 1, label: 1 },
        caller: '0x0000000000000000000000000000000000000000000000000000000123456789'
      }
    });
    stubs.updateLotCrewStatus = this._sandbox.stub(PackedLotDataService, 'updateLotCrewStatus').resolves();
  });

  afterEach(function () {
    return this.utils.resetCollections(['Activity', 'Entity', 'LocationComponent']);
  });

  describe('processEvent', function () {
    it('should create an Activity Item correctly', async function () {
      const handler = new Handler(event);

      await handler.processEvent();
      const activityDocs = await mongoose.model('Activity').find({});
      expect(activityDocs).to.have.lengthOf(1);
      expect(handler.messages._messages).to.have.lengthOf(1);
      expect(handler.messages._messages).to.deep.equal([{ to: 'Crew::1' }]);
    });

    it('should update the marketplace(s)', async function () {
      const openSeaStub = this._sandbox.stub(OpenSea, 'updateAsteroidAsset').resolves();
      const unframedStub = this._sandbox.stub(Unframed, 'updateAsteroidAsset').resolves();
      await (new Handler(event)).processEvent();

      expect(openSeaStub.calledOnce).to.equal(true);
      expect(unframedStub.calledOnce).to.equal(true);
    });

    it('should update the packed lot data for the crew status', async function () {
      await mongoose.model('LocationComponent').create({
        entity: Entity.Building(1),
        location: Entity.lotFromIndex(250_000, 1)
      });
      const handler = new Handler(event);

      await handler.processEvent();
      expect(stubs.updateLotCrewStatus.calledOnce).to.equal(true);
    });
  });

  describe('transformEventData', function () {
    it('should transform the data correctly', function () {
      expect(Handler.transformEventData(event)).to.deep.equal(event.returnValues);
    });
  });
});
