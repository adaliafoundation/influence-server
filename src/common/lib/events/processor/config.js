const appConfig = require('config');
const { Address } = require('@influenceth/sdk');
const { get, isNil, reduce } = require('lodash');
const handlers = require('../handlers');

const CONTRACT_ARVAD_CREW_SALE = appConfig.get('Contracts.ethereum.arvadCrewSale');
const CONTRACT_ASTEROID = appConfig.get('Contracts.ethereum.asteroid');
const CONTRACT_ASTEROID_BRIDGE = appConfig.get('Contracts.ethereum.asteroidBridge');
const CONTRACT_ASTEROID_NAMES = appConfig.get('Contracts.ethereum.asteroidNames');
const CONTRACT_ASTEROID_SALE = appConfig.get('Contracts.ethereum.asteroidSale');
const CONTRACT_ASTEROID_SCANS = appConfig.get('Contracts.ethereum.asteroidScans');
const CONTRACT_CREW = appConfig.get('Contracts.ethereum.crew');
const CONTRACT_CREW_BRIDGE = appConfig.get('Contracts.ethereum.crewBridge');
const CONTRACT_CREW_TOKEN = appConfig.get('Contracts.ethereum.crewToken');
const CONTRACT_CREW_NAMES = appConfig.get('Contracts.ethereum.crewNames');
const CONTRACT_CREWMATE = appConfig.get('Contracts.ethereum.crewmate');
const CONTRACT_CREWMATE_BRIDGE = appConfig.get('Contracts.ethereum.crewmateBridge');
const CONTRACT_SHIP = appConfig.get('Contracts.ethereum.ship');
const CONTRACT_SHIP_BRIDGE = appConfig.get('Contracts.ethereum.shipBridge');
const CONTRACT_STARKNET_CORE = appConfig.get('Contracts.ethereum.starknetCore');
const CONTRACT_SWAY_GOVERNOR = appConfig.get('Contracts.ethereum.swayGovernor');
const STARKNET_CONTRACT_ASTEROID = appConfig.get('Contracts.starknet.asteroid');
const STARKNET_CONTRACT_CREW = appConfig.get('Contracts.starknet.crew');
const STARKNET_CONTRACT_CREWMATE = appConfig.get('Contracts.starknet.crewmate');
const STARKNET_CONTRACT_DISPATCHER = appConfig.get('Contracts.starknet.dispatcher');
const STARKNET_CONTRACT_SHIP = appConfig.get('Contracts.starknet.ship');
const STARKNET_CONTRACT_SWAY = appConfig.get('Contracts.starknet.sway');

const addressHandlerMap = {
  [CONTRACT_ARVAD_CREW_SALE]: handlers.ethereum.ArvadCrewSale,
  [CONTRACT_ASTEROID]: handlers.ethereum.AsteroidToken,
  [CONTRACT_ASTEROID_BRIDGE]: handlers.ethereum.AsteroidBridge,
  [CONTRACT_ASTEROID_NAMES]: handlers.ethereum.AsteroidNames,
  [CONTRACT_ASTEROID_SALE]: handlers.ethereum.AsteroidSale,
  [CONTRACT_ASTEROID_SCANS]: handlers.ethereum.AsteroidScans,
  [CONTRACT_CREW]: handlers.ethereum.Crew,
  [CONTRACT_CREW_BRIDGE]: handlers.ethereum.CrewBridge,
  [CONTRACT_CREW_TOKEN]: handlers.ethereum.CrewToken,
  [CONTRACT_CREW_NAMES]: handlers.ethereum.CrewNames,
  [CONTRACT_CREWMATE_BRIDGE]: handlers.ethereum.CrewmateBridge,
  [CONTRACT_CREWMATE]: handlers.ethereum.CrewmateToken,
  [CONTRACT_SHIP]: handlers.ethereum.Ship,
  [CONTRACT_SHIP_BRIDGE]: handlers.ethereum.ShipBridge,
  [CONTRACT_STARKNET_CORE]: handlers.ethereum.IStarknetCore,
  [CONTRACT_SWAY_GOVERNOR]: handlers.ethereum.SwayGovernor,
  [STARKNET_CONTRACT_ASTEROID]: handlers.starknet.Asteroid,
  [STARKNET_CONTRACT_CREW]: handlers.starknet.Crew,
  [STARKNET_CONTRACT_CREWMATE]: handlers.starknet.Crewmate,
  [STARKNET_CONTRACT_DISPATCHER]: handlers.starknet.Dispatcher,
  [STARKNET_CONTRACT_SHIP]: handlers.starknet.Ship,
  [STARKNET_CONTRACT_SWAY]: handlers.starknet.Sway
};

class EventConfig {
  static #handlerConfig;

  static get config() {
    if (!this.#handlerConfig) this.buildHandlerConfig(addressHandlerMap);
    return this.#handlerConfig;
  }

  static buildHandlerConfig(handlerMap) {
    this.#handlerConfig = reduce(handlerMap, (acc, config, address) => {
      if (isNil(address) || address === 'undefined') throw new Error('missing address for contract');
      const key = Address.toStandard(address);
      const _config = reduce(config, (eventAcc, handler) => {
        Object.assign(eventAcc, { [handler.eventName]: handler });
        return eventAcc;
      }, {});
      acc[key] = _config;
      return acc;
    }, {});
  }

  static getHandlerByAddressAndEvent({ address, eventName }) {
    return get(this.config, [Address.toStandard(address), eventName]);
  }
}

module.exports = EventConfig;
