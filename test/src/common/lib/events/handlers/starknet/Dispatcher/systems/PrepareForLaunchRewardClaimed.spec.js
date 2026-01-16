const { expect } = require('chai');
const mongoose = require('mongoose');
const { OpenSea, Unframed } = require('@common/lib/marketplaces');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/systems/PrepareForLaunchRewardClaimed');

describe('Dispacher::PrepareForLaunchRewardClaimed Handler', function () {
  let event;

  before(function () {
    event = mongoose.model('Starknet')({
      event: 'PrepareForLaunchRewardClaimed',
      data: [
        '0x3', '0x1',
        '0x123456789'
      ],
      logIndex: 1,
      timestamp: 1695691834,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      returnValues: {
        asteroid: { id: 1, label: 3 },
        caller: '0x0000000000000000000000000000000000000000000000000000000123456789'
      }
    });
  });

  afterEach(function () {
    return this.utils.resetCollections(['Activity', 'AsteroidRewardComponent', 'Entity']);
  });

  describe('processEvent', function () {
    it('should create an Activity Item correctly', async function () {
      const handler = new Handler(event);

      await handler.processEvent();
      const activityDocs = await mongoose.model('Activity').find({});
      expect(activityDocs).to.have.lengthOf(1);
      expect(handler.messages._messages).to.have.lengthOf(1);
      expect(handler.messages._messages).to.deep.equal([{ to: 'Asteroid::1' }]);
    });

    it('should set hasPrepareForLaunchCrewmate to false on the AsteroidReward component', async function () {
      await (new Handler(event)).processEvent();
      const doc = await mongoose.model('AsteroidRewardComponent').findOne({ entity: { id: 1, label: 3 } });
      expect(doc.hasPrepareForLaunchCrewmate).to.equal(false);
    });

    it('should update the marketplace(s)', async function () {
      const openSeaStub = this._sandbox.stub(OpenSea, 'updateAsteroidAsset').resolves();
      const unframedStub = this._sandbox.stub(Unframed, 'updateAsteroidAsset').resolves();
      await (new Handler(event)).processEvent();

      expect(openSeaStub.calledOnce).to.equal(true);
      expect(unframedStub.calledOnce).to.equal(true);
    });
  });

  describe('transformEventData', function () {
    it('should transform the data correctly', function () {
      const result = Handler.transformEventData(event);
      expect(result).to.deep.equal(event.returnValues);
    });
  });
});
