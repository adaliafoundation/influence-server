const { expect } = require('chai');
const mongoose = require('mongoose');
const { ContractPolicyAssigned: Handler } = require('@common/lib/events/handlers/starknet/Dispatcher/systems');

describe('ContractPolicyAssigned Handler', function () {
  let event;

  beforeEach(function () {
    event = mongoose.model('Starknet')({
      event: 'ContractPolicyAssigned',
      data: [
        '0x5', '0x1',
        '0x1',
        '0x123',
        '0x1', '0x1',
        '0x123456789'
      ],
      logIndex: 1,
      timestamp: 1695691834,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      returnValues: {
        entity: { label: 5, id: 1 },
        permission: 1,
        contract: '0x0000000000000000000000000000000000000000000000000000000000000123',
        callerCrew: { label: 1, id: 1 },
        caller: '0x0000000000000000000000000000000000000000000000000000000123456789'
      }
    });
  });

  afterEach(function () {
    return this.utils.resetCollections(['Activity', 'Entity']);
  });

  describe('processEvent', function () {
    it('should create an Activity Item correctly', async function () {
      const handler = new Handler(event);
      await handler.processEvent();
      const activityDocs = await mongoose.model('Activity').find({});
      expect(activityDocs).to.have.lengthOf(1);
    });
  });

  describe('transformEventData', function () {
    it('should transform the data correctly', function () {
      expect(Handler.transformEventData(event)).to.deep.equal(event.returnValues);
    });
  });
});
