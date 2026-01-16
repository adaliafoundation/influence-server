const appConfig = require('config');
const { Address } = require('@influenceth/sdk');

const assetTypeFromAddress = (address) => {
  const CONTRACT_ASTEROID_BRIDGE = appConfig.get('Contracts.ethereum.asteroidBridge');
  const CONTRACT_CREW_BRIDGE = appConfig.get('Contracts.ethereum.crewBridge');
  const CONTRACT_CREWMATE_BRIDGE = appConfig.get('Contracts.ethereum.crewmateBridge');
  const CONTRACT_SHIP_BRIDGE = appConfig.get('Contracts.ethereum.shipBridge');
  const CONTRACT_SWAY_BRIDGE = appConfig.get('Contracts.ethereum.swayBridge');

  const STARKNET_CONTRACT_ASTEROID = appConfig.get('Contracts.starknet.asteroid');
  const STARTNET_CONTRACT_CREW = appConfig.get('Contracts.starknet.crew');
  const STARTNET_CONTRACT_CREWMATE = appConfig.get('Contracts.starknet.crewmate');
  const STARKNET_CONTRACT_SHIP = appConfig.get('Contracts.starknet.ship');
  const STARKNET_CONTRACT_SWAY = appConfig.get('Contracts.starknet.sway');

  if ((Address.areEqual(address, CONTRACT_ASTEROID_BRIDGE, 'ethereum', 'ethereum')
  || Address.areEqual(address, STARKNET_CONTRACT_ASTEROID, 'starknet', 'starknet'))) {
    return 'Asteroid';
  }

  if ((Address.areEqual(address, CONTRACT_CREW_BRIDGE, 'ethereum', 'ethereum')
  || Address.areEqual(address, STARTNET_CONTRACT_CREW, 'starknet', 'starknet'))) {
    return 'Crew';
  }

  if ((Address.areEqual(address, CONTRACT_CREWMATE_BRIDGE, 'ethereum', 'ethereum')
  || Address.areEqual(address, STARTNET_CONTRACT_CREWMATE, 'starknet', 'starknet'))) {
    return 'Crewmate';
  }

  if ((Address.areEqual(address, CONTRACT_SHIP_BRIDGE, 'ethereum', 'ethereum')
  || Address.areEqual(address, STARKNET_CONTRACT_SHIP, 'starknet', 'starknet'))) {
    return 'Ship';
  }

  if ((Address.areEqual(address, CONTRACT_SWAY_BRIDGE, 'ethereum', 'ethereum')
  || Address.areEqual(address, STARKNET_CONTRACT_SWAY, 'starknet', 'starknet'))) {
    return 'Sway';
  }

  throw new Error('Error determining asset type from address');
};

module.exports = {
  assetTypeFromAddress
};
