const appConfig = require('config');
const { uint256: { uint256ToBN }, number: { toHex } } = require('starknet');
const { Address } = require('@influenceth/sdk');
const { BRIDGING_STATES, CHAINS } = require('@common/constants');
const { CrossingService, SwayCrossingService } = require('@common/services');
const BaseHandler = require('../Handler');
const { assetTypeFromAddress } = require('./utils');

class Handler extends BaseHandler {
  static eventName = 'LogMessageToL1';

  static eventFilter = {
    fromAddress: [
      BigInt(Address.toStandard(appConfig.get('Contracts.starknet.asteroid'), 'starknet')).toString(),
      BigInt(Address.toStandard(appConfig.get('Contracts.starknet.crew'), 'starknet')).toString(),
      BigInt(Address.toStandard(appConfig.get('Contracts.starknet.crewmate'), 'starknet')).toString(),
      BigInt(Address.toStandard(appConfig.get('Contracts.starknet.ship'), 'starknet')).toString(),
      BigInt(Address.toStandard(appConfig.get('Contracts.starknet.sway'), 'starknet')).toString(),
      Address.toStandard(appConfig.get('Contracts.starknet.asteroid'), 'starknet'),
      Address.toStandard(appConfig.get('Contracts.starknet.crew'), 'starknet'),
      Address.toStandard(appConfig.get('Contracts.starknet.crewmate'), 'starknet'),
      Address.toStandard(appConfig.get('Contracts.starknet.ship'), 'starknet'),
      Address.toStandard(appConfig.get('Contracts.starknet.sway'), 'starknet')
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
    const { returnValues: { fromAddress, payload, toAddress } } = this.eventDoc;
    const assetType = assetTypeFromAddress(fromAddress);

    if (assetType === 'Sway') {
      await SwayCrossingService.incrementReady({
        data: {
          amount: toHex(uint256ToBN({ low: payload[2], high: payload[3] })),
          toAddress: Address.toStandard(payload[1], 'ethereum')
        },
        event: this.eventDoc
      });
    } else {
      await CrossingService.updateOrCreateFromEvent({
        data: {
          assetIds: payload.slice(4).map(Number),
          assetType,
          destination: CHAINS.ETHEREUM,
          destinationBridge: Address.toStandard(toAddress, 'ethereum'),
          fromAddress: Address.toStandard(payload[2], 'starknet'),
          origin: CHAINS.STARKNET,
          originBridge: Address.toStandard(fromAddress, 'starknet'),
          status: BRIDGING_STATES.PROCESSING,
          toAddress: Address.toStandard(payload[3], 'ethereum')
        },
        event: this.eventDoc
      });
    }
  }
}

module.exports = Handler;
