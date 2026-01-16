const { expect } = require('chai');
const mongoose = require('mongoose');
const { ElasticSearchService, NftComponentService } = require('@common/services');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/components/Ship');

describe('ComponentUpdated: Ship Handler', function () {
  let event;
  const stubs = {
    flagForCardUpdate: null,
    queueEntityForIndexing: null
  };

  before(function () {
    stubs.flagForCardUpdate = this._sandbox.stub(NftComponentService, 'flagForCardUpdate').resolves();
    stubs.queueEntityForIndexing = this._sandbox.stub(ElasticSearchService, 'queueEntityForIndexing').resolves();
    event = mongoose.model('Starknet')({
      event: 'ComponentUpdated_Ship',
      logIndex: 1,
      timestamp: 1695691834,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      data: [
        '0x1', '0x10006',
        '0x1',
        '0x2',
        '0x64a59467',
        '0x2',
        '0x1',
        '0x1', '0x1',
        '0x1',
        '0x1', '0x2',
        '0x1'
      ],
      returnValues: {
        entity: { label: 6, id: 1 },
        shipType: 1,
        status: 2,
        readyAt: 1688573031,
        variant: 2,
        emergencyAt: 1,
        transitOrigin: { label: 1, id: 1 },
        transitDeparture: 1,
        transitDestination: { label: 1, id: 2 },
        transitArrival: 1
      }
    });
  });

  afterEach(function () {
    return this.utils.resetCollections(['ShipComponent']);
  });

  describe('processEvent', function () {
    it('should create/update the ShipComponent', async function () {
      await (new Handler(event)).processEvent();
      const docs = await mongoose.model('ShipComponent').find().lean();
      expect(docs).to.have.lengthOf(1);
    });

    it('should flag the NftComponent for card update', async function () {
      await (new Handler(event)).processEvent();
      expect(stubs.flagForCardUpdate.calledOnce).to.equal(true);
    });

    it('queue the entity for indexing', async function () {
      await (new Handler(event)).processEvent();
      expect(stubs.queueEntityForIndexing.calledOnce).to.equal(true);
    });
  });

  describe('transformEventData', function () {
    it('should transform the data correctly', function () {
      expect(Handler.transformEventData(event)).to.deep.equal(event.returnValues);
    });
  });
});
