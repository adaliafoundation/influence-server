const { expect } = require('chai');
const { Address } = require('@influenceth/sdk');
const appConfig = require('config');
const mongoose = require('mongoose');
const Handler = require('@common/lib/events/handlers/ethereum/common/BridgeToStarknet');

describe('BridgeToStarknet Common Handler', function () {
  describe('getBridgeStatus', function () {
    it('should return the correct status for the following caes', function () {
      const event = mongoose.model('Ethereum')({
        event: 'BridgeToStarknet',
        logIndex: 1,
        timestamp: 1695691834,
        transactionIndex: 1,
        transactionHash: '0x123456789',
        returnValues: {
          l1Contract: appConfig.get('Contracts.ethereum.asteroidBridge'),
          l1Account: '0x4B37Fb577D2e89812594bEE3A0124D7448084BDd',
          l2Account: '917476384115720854794616797117969392552273877743180770751417131002681153336',
          tokenId: '1'
        }
      });
      let result;
      const handler = new Handler(event);

      result = handler.getBridgeStatus({ owners: { starknet: null } });
      expect(result).to.equal('PROCESSING');

      result = handler.getBridgeStatus({ owners: { starknet: undefined } });
      expect(result).to.equal('PROCESSING');

      result = handler.getBridgeStatus({ owners: { starknet: appConfig.get('Contracts.starknet.asteroid') } });
      expect(result).to.equal('PROCESSING');

      result = handler.getBridgeStatus({ owners: { starknet: appConfig.get('Contracts.starknet.crewmate') } });
      expect(result).to.equal('PROCESSING');

      result = handler.getBridgeStatus({ owners: { starknet: Address.toStandard('0', 'starknet') } });
      expect(result).to.equal('PROCESSING');

      result = handler.getBridgeStatus({ owners: { starknet: Address.toStandard('0x123456789', 'starknet') } });
      expect(result).to.equal('COMPLETE');
    });
  });
});
