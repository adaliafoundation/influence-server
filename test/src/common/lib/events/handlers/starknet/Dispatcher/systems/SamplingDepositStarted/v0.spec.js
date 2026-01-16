const { expect } = require('chai');
const mongoose = require('mongoose');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/systems/SamplingDepositStarted/v0');
const Entity = require('@common/lib/Entity');

describe('SamplingDepositStarted Handler (v0)', function () {
  let event;

  before(async function () {
    event = mongoose.model('Starknet')({
      event: 'SamplingDepositStarted',
      logIndex: 1,
      timestamp: 1695691834,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      returnValues: {
        deposit: { id: 1, label: 7 },
        lot: { id: 1, label: 4 },
        resource: 1,
        finishTime: 1695691834,
        callerCrew: { id: 1, label: 1 },
        caller: '0x0000000000000000000000000000000000000000000000000000000123456789'
      }
    });
  });

  afterEach(function () {
    return this.utils.resetCollections(['Activity', 'Entity']);
  });

  describe('hashKeys', function () {
    it('should return the correct hashKeys', function () {
      expect(Handler.hashKeys).to.deep.equal([
        'name',
        'returnValues.deposit.id'
      ]);
    });
  });

  describe('processEvent', function () {
    it('should create an Activity Item correctly', async function () {
      const { returnValues: { callerCrew } } = event.toJSON();
      await (new Handler(event)).processEvent();
      const activityDocs = await mongoose.model('Activity').find({});
      expect(activityDocs).to.have.lengthOf(1);
      expect(activityDocs[0].toJSON().unresolvedFor).to.deep.equal([Entity.Crew(callerCrew.id).toObject()]);
    });
  });

  describe('transformEventData', function () {
    it('should transform the data correctly', function () {
      const result = Handler.transformEventData({
        data: [
          '0x7', '0x1',
          '0x4', '0x1',
          '0x1',
          '0x6512343a',
          '0x1', '0x1',
          '0x123456789'
        ]
      });

      expect(result).to.deep.equal(event.returnValues);
    });
  });
});
