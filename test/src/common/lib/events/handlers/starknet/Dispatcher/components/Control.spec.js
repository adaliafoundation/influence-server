const { expect } = require('chai');
const mongoose = require('mongoose');
const Entity = require('@common/lib/Entity');
const { ElasticSearchService } = require('@common/services');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/components/Control');

describe('ComponentUpdated: Control Handler', function () {
  let event;
  const stubs = {
    queueEntityForIndexing: null,
    queueEntitiesForIndexing: null
  };

  beforeEach(async function () {
    event = mongoose.model('Starknet')({
      data: ['0x1', '0x10003', '0x1', '0x1'],
      blockNumber: 1,
      transactionHash: '0x123',
      logIndex: 0,
      timestamp: 1,
      event: 'ComponentUpdated_Control',
      returnValues: {
        entity: { label: 3, id: 1 },
        controller: { label: 1, id: 1 }
      }
    });

    await mongoose.model('LocationComponent').create([
      {
        entity: Entity.Building(1),
        location: Entity.Asteroid(1),
        locations: [Entity.Asteroid(1)]
      },
      {
        entity: Entity.Building(2),
        location: Entity.Asteroid(1),
        locations: [Entity.Asteroid(1)]
      }
    ]);

    await mongoose.model('ControlComponent').create({
      entity: Entity.Asteroid(1),
      controller: Entity.Crew(2)
    });

    stubs.queueEntityForIndexing = this._sandbox.stub(ElasticSearchService, 'queueEntityForIndexing').resolves();
    stubs.queueEntitiesForIndexing = this._sandbox.stub(
      ElasticSearchService,
      'queueEntitiesForIndexing'
    )
      .resolves();
  });

  afterEach(function () {
    return this.utils.resetCollections(['ControlComponent', 'Entity', 'LocationComponent']);
  });

  describe('processEvent', function () {
    it('should queue buildings that are located on this asteroid for indexing', async function () {
      const handler = new Handler(event);
      await handler.processEvent();
      expect(stubs.queueEntityForIndexing.calledOnce).to.equal(true);
      expect(stubs.queueEntityForIndexing.calledOnce).to.equal(true);
    });
  });

  describe('transformEventData', function () {
    it('should transform the data correctly', function () {
      expect(Handler.transformEventData(event)).to.deep.equal(event.returnValues);
    });
  });
});
