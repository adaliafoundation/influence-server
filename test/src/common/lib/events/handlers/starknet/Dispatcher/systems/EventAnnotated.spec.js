const { expect } = require('chai');
const mongoose = require('mongoose');
const moment = require('moment');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/systems/EventAnnotated');

describe('EventAnnotated Handler', function () {
  let event;

  beforeEach(function () {
    event = mongoose.model('Starknet')({
      blockNumber: 1000,
      blockHash: '0x56789',
      data: [
        '0x338e725ea3b57fbe79e218f1fe63f1e01773916642a4a586cbdb4cf62de11815',
        '0x1',
        '0x2', '0x516d61553176524572674c424d4e39424a557432727645626a4559474e4665', '0x373650675a506a34384e6277444e64',
        '0x1', '0x1',
        '0x123456789'
      ],
      event: 'EventAnnotated',
      logIndex: 1,
      returnValues: {
        transactionHash: '0x338e725ea3b57fbe79e218f1fe63f1e01773916642a4a586cbdb4cf62de11815',
        logIndex: 1,
        contentHash: 'QmaU1vRErgLBMN9BJUt2rvEbjEYGNFe76PgZPj48NbwDNd',
        callerCrew: { id: 1, label: 1 },
        caller: '0x0000000000000000000000000000000000000000000000000000000123456789'
      },
      timestamp: moment().unix() + 10000,
      transactionIndex: 1,
      transactionHash: '0x1234567899'
    });
  });

  afterEach(function () {
    return this.utils.resetCollections(['Event']);
  });

  describe('transformEventData', function () {
    it('should transform the data correctly', function () {
      expect(Handler.transformEventData(event)).to.deep.equal(event.returnValues);
    });
  });
});
