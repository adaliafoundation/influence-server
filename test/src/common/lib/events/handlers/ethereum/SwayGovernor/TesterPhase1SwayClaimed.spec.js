const { expect } = require('chai');
const mongoose = require('mongoose');
const moment = require('moment');
const Handler = require('@common/lib/events/handlers/ethereum/SwayGovernor/TesterPhase1SwayClaimed');

describe('SwayGovernor::TesterPhase1SwayClaimed event handler', function () {
  afterEach(function () {
    return this.utils.resetCollections(['Event', 'SwayClaim']);
  });

  describe('processEvent', function () {
    it('should update claims with claimed=true', async function () {
      const eventDoc = mongoose.model('Ethereum')({
        event: 'TesterPhase1SwayClaimed',
        blockNumber: 1,
        transactionHash: '0x123456789',
        returnValues: {
          0: '0x55A30026e0896CFee359a5762BeA418D989b7682',
          1: '12345678',
          account: '0x55A30026e0896CFee359a5762BeA418D989b7682',
          amount: '12345678'
        },
        timestamp: moment().unix()
      });

      await mongoose.model('SwayClaim').create({
        address: '0x55A30026e0896CFee359a5762BeA418D989b7682',
        phase: 'Testnet 1',
        amount: 12345678,
        proof: [],
        claimed: false
      });

      await (new Handler(eventDoc)).processEvent();

      const claimDoc = await mongoose.model('SwayClaim').findOne({
        address: '0x55A30026e0896CFee359a5762BeA418D989b7682'
      });

      expect(claimDoc.claimed).to.equal(true);
    });
  });
});
