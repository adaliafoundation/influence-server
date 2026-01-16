const appConfig = require('config');
const { Address } = require('@influenceth/sdk');
const { CHAINS } = require('@common/constants');
const { CrossingService } = require('@common/services');
const BaseHandler = require('../Handler');
const { assetTypeFromAddress } = require('./utils');

class Handler extends BaseHandler {
  static eventName = 'ConsumedMessageToL2';

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
    const { returnValues: { fromAddress, payload } } = this.eventDoc;
    const data = { assetType: assetTypeFromAddress(fromAddress) };
    let assetIds;

    switch (data.assetType) {
      case 'Asteroid':
        assetIds = payload.slice(2).map(Number);
        break;
      case 'Crew':
        assetIds = payload.slice(3).map(Number);
        break;
      case 'Crewmate':
        assetIds = payload.slice(2).filter((value, index) => ((index % 2) === 0));
        break;
      case 'Ship':
        assetIds = payload.slice(3).map(Number);
        break;
      default:
        throw new Error('Error determining asset type from address');
    }

    // The bridge process is complete at this point, drop the related crossing document (if exists)
    await CrossingService.removeOne({
      assetType: data.assetType,
      assetIds,
      destination: CHAINS.STARKNET,
      origin: CHAINS.ETHEREUM
    });
  }
}

module.exports = Handler;
