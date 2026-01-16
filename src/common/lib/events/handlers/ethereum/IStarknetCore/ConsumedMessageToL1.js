const appConfig = require('config');
const { uint256: { uint256ToBN }, number: { toHex } } = require('starknet');
const { Address } = require('@influenceth/sdk');
const { CHAINS } = require('@common/constants');
const { CrossingService, SwayCrossingService } = require('@common/services');
const BaseHandler = require('../Handler');
const { assetTypeFromAddress } = require('./utils');

class Handler extends BaseHandler {
  static eventName = 'ConsumedMessageToL1';

  static eventFilter = {
    fromAddress: [
      BigInt(Address.toStandard(appConfig.get('Contracts.starknet.asteroid'), 'starknet')).toString(),
      BigInt(Address.toStandard(appConfig.get('Contracts.starknet.crew'), 'starknet')).toString(),
      BigInt(Address.toStandard(appConfig.get('Contracts.starknet.crewmate'), 'starknet')).toString(),
      BigInt(Address.toStandard(appConfig.get('Contracts.starknet.ship'), 'starknet')).toString(),
      BigInt(Address.toStandard(appConfig.get('Contracts.starknet.sway'), 'starknet')).toString(),
      Address.toStandard(appConfig.get('Contracts.starknet.asteroid')),
      Address.toStandard(appConfig.get('Contracts.starknet.crew')),
      Address.toStandard(appConfig.get('Contracts.starknet.crewmate')),
      Address.toStandard(appConfig.get('Contracts.starknet.ship')),
      Address.toStandard(appConfig.get('Contracts.starknet.sway'))
    ],
    toAddress: [
      Address.toStandard(appConfig.get('Contracts.ethereum.asteroidBridge'), 'ethereum'),
      Address.toStandard(appConfig.get('Contracts.ethereum.crewBridge'), 'ethereum'),
      Address.toStandard(appConfig.get('Contracts.ethereum.crewmateBridge'), 'ethereum'),
      Address.toStandard(appConfig.get('Contracts.ethereum.shipBridge'), 'ethereum'),
      Address.toStandard(appConfig.get('Contracts.ethereum.swayBridge'), 'ethereum')
    ]
  };

  async processEvent() {
    const { returnValues: { fromAddress, payload } } = this.eventDoc;
    const assetType = assetTypeFromAddress(fromAddress);

    // The bridge process is complete at this point, drop the related crossing document (if exists)
    if (assetType === 'Sway') {
      await SwayCrossingService.decrementReady({
        data: {
          amount: toHex(uint256ToBN({ low: payload[2], high: payload[3] })),
          toAddress: Address.toStandard(payload[1])
        },
        event: this.eventDoc
      });
    } else {
      await CrossingService.removeOne({
        assetType,
        assetIds: payload.slice(4).map(Number),
        destination: CHAINS.ETHEREUM,
        origin: CHAINS.STARKNET
      });
    }
  }
}

module.exports = Handler;
