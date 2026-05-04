const appConfig = require('config');
const { reduce } = require('lodash');
const { Address: { toStandard }, ethereumContracts: abis } = require('@influenceth/sdk');
const logger = require('@common/lib/logger');
const web3 = require('@common/lib/web3');
const { FMT_BYTES, FMT_NUMBER } = require('web3');
const { ethereum: handlers } = require('../../handlers');

const CONTRACT_ARVAD_CREW_SALE = appConfig.get('Contracts.ethereum.arvadCrewSale');
const CONTRACT_ASTEROID = appConfig.get('Contracts.ethereum.asteroid');
const CONTRACT_ASTEROID_BRIDGE = appConfig.get('Contracts.ethereum.asteroidBridge');
const CONTRACT_ASTEROID_NAMES = appConfig.get('Contracts.ethereum.asteroidNames');
const CONTRACT_ASTEROID_SALE = appConfig.get('Contracts.ethereum.asteroidSale');
const CONTRACT_ASTEROID_SCANS = appConfig.get('Contracts.ethereum.asteroidScans');
const CONTRACT_CREW = appConfig.get('Contracts.ethereum.crew');
const CONTRACT_CREW_BRIDGE = appConfig.get('Contracts.ethereum.crewBridge');
const CONTRACT_CREW_TOKEN = appConfig.get('Contracts.ethereum.crewToken');
const CONTRACT_CREWMATE = appConfig.get('Contracts.ethereum.crewmate');
const CONTRACT_CREWMATE_BRIDGE = appConfig.get('Contracts.ethereum.crewmateBridge');
const CONTRACT_CREW_NAMES = appConfig.get('Contracts.ethereum.crewNames');
const CONTRACT_SHIP = appConfig.get('Contracts.ethereum.ship');
const CONTRACT_SHIP_BRIDGE = appConfig.get('Contracts.ethereum.shipBridge');
const CONTRACT_STARKNET_CORE = appConfig.get('Contracts.ethereum.starknetCore');
const CONTRACT_SWAY_GOVERNOR = appConfig.get('Contracts.ethereum.swayGovernor');

const ADDRESS_NAME_MAP = {
  [CONTRACT_ARVAD_CREW_SALE]: {
    name: 'ArvadCrewSale',
    handlers: handlers.ArvadCrewSale
  },
  [CONTRACT_ASTEROID]: {
    name: 'AsteroidToken',
    handlers: handlers.AsteroidToken
  },
  [CONTRACT_ASTEROID_BRIDGE]: {
    name: 'AsteroidBridge',
    handlers: handlers.AsteroidBridge
  },
  [CONTRACT_ASTEROID_SALE]: {
    name: 'AsteroidSale',
    handlers: handlers.AsteroidSale
  },
  [CONTRACT_ASTEROID_NAMES]: {
    name: 'AsteroidNames',
    handlers: handlers.AsteroidNames
  },
  [CONTRACT_ASTEROID_SCANS]: {
    name: 'AsteroidScans',
    handlers: handlers.AsteroidScans
  },
  [CONTRACT_CREW]: {
    name: 'Crew',
    handlers: handlers.Crew
  },
  [CONTRACT_CREW_BRIDGE]: {
    name: 'CrewBridge',
    handlers: handlers.CrewBridge
  },
  [CONTRACT_CREW_TOKEN]: {
    name: 'CrewToken',
    handlers: handlers.CrewToken
  },
  [CONTRACT_CREW_NAMES]: {
    name: 'CrewNames',
    handlers: handlers.CrewNames
  },
  [CONTRACT_CREWMATE]: {
    name: 'CrewmateToken',
    handlers: handlers.CrewmateToken
  },
  [CONTRACT_CREWMATE_BRIDGE]: {
    name: 'CrewmateBridge',
    handlers: handlers.CrewmateBridge
  },
  [CONTRACT_SHIP]: {
    name: 'Ship',
    handlers: handlers.Ship
  },
  [CONTRACT_SHIP_BRIDGE]: {
    name: 'ShipBridge',
    handlers: handlers.ShipBridge
  },
  [CONTRACT_STARKNET_CORE]: {
    name: 'IStarknetCore',
    handlers: handlers.IStarknetCore
  },
  [CONTRACT_SWAY_GOVERNOR]: {
    name: 'SwayGovernor',
    handlers: handlers.SwayGovernor
  }
};

class EthereumEventsConfig {
  static _eventsConfig;

  static getContractInstance(name, address) {
    let contract;
    const _address = toStandard(address, 'ethereum');

    // init web3 contract
    const abi = abis[name];
    if (!abi) {
      throw new Error(`No abi found for ${name}`);
    }

    try {
      contract = new web3.eth.Contract(abi, _address, { bytes: FMT_BYTES.HEX, number: FMT_NUMBER.NUMBER });
    } catch (error) {
      logger.error(`Error initializing contract ${name} with address ${_address}`);
      logger.error(error);
    }

    return contract;
  }

  static getContractAbi(name) {
    const abi = abis[name];
    if (!abi) throw new Error(`No abi found for ${name}`);
    return abi;
  }

  static getEventAbiItem(abi, eventName) {
    return abi.find((item) => item.type === 'event' && item.name === eventName);
  }

  /**
   * @description Creates a map of contract addresses to event names and handlers. Event names are encoded.
   *
   * @param {Object} handlerMap
   */
  static buildEventsConfig(handlerMap) {
    this._eventsConfig = reduce(handlerMap, (acc, cfg, address) => {
      if (!address || address === 'undefined') return acc;
      const _address = toStandard(address, 'ethereum');
      const abi = this.getContractAbi(cfg.name);
      acc[_address] = {
        abi,
        address: _address,
        eventTopicMap: {},
        eventTopics: [],
        handlers: cfg.handlers
      };

      // init web3 contract
      const contract = this.getContractInstance(cfg.name, address);
      if (!contract) return acc;
      acc[_address].contract = contract;

      Object.values(cfg.handlers).forEach((handler) => {
        const abiItem = this.getEventAbiItem(abi, handler.eventName);
        if (!abiItem) return;

        const topic = web3.eth.abi.encodeEventSignature(abiItem);
        acc[_address].eventTopicMap[topic] = {
          abiItem,
          handler
        };
        acc[_address].eventTopics.push(topic);
      });

      return acc;
    }, {});
  }

  static get config() {
    if (!this._eventsConfig) this.buildEventsConfig(ADDRESS_NAME_MAP);
    return this._eventsConfig;
  }

  static getHandler(event) {
    const address = event.from_address || event.address;
    if (!address) return null;

    const contractConfig = this.config[toStandard(address, 'ethereum')];
    return contractConfig ? contractConfig.handlers[event.event] : null;
  }

  static getConfigByAddress(address) {
    return this.config[toStandard(address, 'ethereum')];
  }

  static getHandlerConfigByLog(log) {
    const address = log?.address ? toStandard(log.address, 'ethereum') : null;
    if (!address) return null;

    const contractConfig = this.config[address];
    if (!contractConfig) return null;

    return contractConfig.eventTopicMap[log.topics?.[0]] || null;
  }

  static decodeRawLog(log) {
    const address = toStandard(log.address, 'ethereum');
    const contractConfig = this.getConfigByAddress(address);
    if (!contractConfig) return null;

    const eventConfig = contractConfig.eventTopicMap[log.topics?.[0]];
    if (!eventConfig) return null;

    const { abiItem, handler } = eventConfig;
    const returnValues = web3.eth.abi.decodeLog(abiItem.inputs, log.data, log.topics.slice(1));

    return {
      address,
      blockHash: log.blockHash,
      blockNumber: Number(log.blockNumber),
      event: handler.eventName,
      logIndex: Number(log.logIndex),
      raw: {
        data: log.data,
        topics: log.topics
      },
      removed: log.removed || false,
      returnValues,
      signature: log.topics?.[0],
      transactionHash: log.transactionHash,
      transactionIndex: Number(log.transactionIndex)
    };
  }

  static matchesEventFilter(event, eventFilter = {}) {
    const filterKeys = Object.keys(eventFilter || {}).filter((key) => key !== 'DEPRECATED_AT');
    if (filterKeys.length === 0) return true;

    return filterKeys.every((key) => {
      const expected = eventFilter[key];
      const actual = event.returnValues?.[key];
      if (Array.isArray(expected)) return expected.map((value) => value.toString()).includes(actual?.toString());
      return actual?.toString() === expected?.toString();
    });
  }

  static getTrackedAddresses() {
    return Object.keys(this.config);
  }

  static getTrackedTopics() {
    return [...new Set(this.toArray().flatMap(({ eventTopics }) => eventTopics || []))];
  }

  /**
   * @description Returns an array of all contract configs
   *
   * @returns Array
   */
  static toArray() {
    return Object.values(this.config);
  }
}

module.exports = EthereumEventsConfig;
