const appConfig = require('config');
const { Address } = require('@influenceth/sdk');
const { BRIDGING_STATES, CHAINS } = require('@common/constants');
const { CrossingService } = require('@common/services');
const BaseHandler = require('../Handler');
const { assetTypeFromAddress } = require('./utils');

class Handler extends BaseHandler {
  static eventName = 'LogMessageToL2';

  static eventFilter = {
    fromAddress: [
      Address.toStandard(appConfig.get('Contracts.ethereum.asteroidBridge'), 'ethereum'),
      Address.toStandard(appConfig.get('Contracts.ethereum.crewBridge'), 'ethereum'),
      Address.toStandard(appConfig.get('Contracts.ethereum.crewmateBridge'), 'ethereum'),
      Address.toStandard(appConfig.get('Contracts.ethereum.shipBridge'), 'ethereum')
    ],
    toAddress: [
      BigInt(Address.toStandard(appConfig.get('Contracts.starknet.asteroid'), 'starknet')).toString(),
      BigInt(Address.toStandard(appConfig.get('Contracts.starknet.crew'), 'starknet')).toString(),
      BigInt(Address.toStandard(appConfig.get('Contracts.starknet.crewmate'), 'starknet')).toString(),
      BigInt(Address.toStandard(appConfig.get('Contracts.starknet.ship'), 'starknet')).toString(),
      Address.toStandard(appConfig.get('Contracts.starknet.asteroid'), 'starknet'),
      Address.toStandard(appConfig.get('Contracts.starknet.crew'), 'starknet'),
      Address.toStandard(appConfig.get('Contracts.starknet.crewmate'), 'starknet'),
      Address.toStandard(appConfig.get('Contracts.starknet.ship'), 'starknet')
    ]
  };

  async processEvent() {
    const { returnValues: { fromAddress, payload, toAddress } } = this.eventDoc;
    const data = { assetType: assetTypeFromAddress(fromAddress) };

    switch (data.assetType) {
      case 'Asteroid':
        data.assetIds = payload.slice(2).map(Number);
        break;
      case 'Crew':
        data.assetIds = payload.slice(3).map(Number);
        break;
      case 'Crewmate':
        data.assetIds = payload.slice(2).filter((value, index) => ((index % 2) === 0));
        break;
      case 'Ship':
        data.assetIds = payload.slice(3).map(Number);
        break;
      default:
        throw new Error('Error determining asset type from address');
    }

    Object.assign(data, {
      destination: CHAINS.STARKNET,
      destinationBridge: Address.toStandard(toAddress, 'starknet'),
      // fromAddress: *Note: This value is not available when bridging from l1 -> l2
      origin: CHAINS.ETHEREUM,
      originBridge: Address.toStandard(fromAddress, 'ethereum'),
      status: BRIDGING_STATES.PROCESSING,
      toAddress: Address.toStandard(payload[0], 'starknet')
    });

    await CrossingService.updateOrCreateFromEvent({ event: this.eventDoc, data });
  }
}

module.exports = Handler;
