const appConfig = require('config');
const { Address } = require('@influenceth/sdk');
const { reduce, set } = require('lodash');
const { num: { toHex } } = require('starknet');
const { starknet: handlers } = require('../../handlers');

const STARKNET_CONTRACT_ASTEROID = appConfig.get('Contracts.starknet.asteroid');
const STARKNET_CONTRACT_CREW = appConfig.get('Contracts.starknet.crew');
const STARKNET_CONTRACT_CREWMATE = appConfig.get('Contracts.starknet.crewmate');
const STARKNET_CONTRACT_DISPATCHER = appConfig.get('Contracts.starknet.dispatcher');
const STARKNET_CONTRACT_SHIP = appConfig.get('Contracts.starknet.ship');
const STARKNET_CONTRACT_SWAY = appConfig.get('Contracts.starknet.sway');

const ADDRESS_NAME_MAP = {
  [STARKNET_CONTRACT_ASTEROID]: handlers.Asteroid,
  [STARKNET_CONTRACT_CREW]: handlers.Crew,
  [STARKNET_CONTRACT_CREWMATE]: handlers.Crewmate,
  [STARKNET_CONTRACT_DISPATCHER]: handlers.Dispatcher,
  [STARKNET_CONTRACT_SHIP]: handlers.Ship,
  [STARKNET_CONTRACT_SWAY]: handlers.Sway
};

class StarknetEventConfig {
  static _eventsConfig;

  /**
   * @description Creates a map of contract addresses to event names and handlers. Event names are encoded.
   *
   * @param {Object} handlerMap
   * @returns Object
   */
  static buildEventsConfig(handlerMap) {
    this._eventsConfig = reduce(handlerMap, (acc, _handlers, address) => {
      if (!address || address === 'undefined') throw new Error('Missing contract address address');
      const _address = Address.toStandard(address, 'starknet');
      acc[_address] = { };
      if (!_handlers) return acc;
      reduce(_handlers, (acc2, handler) => {
        set(acc2, handler.eventNameKey, handler);
        return acc2;
      }, acc[_address]);
      return acc;
    }, {});
  }

  static get config() {
    if (!this._eventsConfig) this.buildEventsConfig(ADDRESS_NAME_MAP);
    return this._eventsConfig;
  }

  /**
   * Takes an onchain event object and returns the handler for that event
   *
   * @param {Object} event
   * @returns Handler Object
   */
  static getHandler(event) {
    if (!event.address) return null;

    // clean up the address (just in case)
    const contractAddress = Address.toStandard(event.address, 'starknet');

    // Get the set of event handlers for this contract
    const contractConfig = this.config[contractAddress];
    if (!contractConfig) return null;

    // assemble the encoded key for this event
    const configKey = event.keys.map(toHex).join('_');
    // let configKey = toHex(event.keys[0]).padStart(64, 0);
    // if (event.keys[1]) configKey += `_${toHex(event.keys[1])}`;
    // if (event.keys[2]) configKey += `_${toHex(event.keys[2])}`;

    return contractConfig[configKey];
  }

  /**
   * @description Returns an array of all contract configs
   *
   * @returns Array
   */
  static toArray() {
    return Object.keys(this.config)
      .reduce(((acc, address) => acc.concat({ address, handlers: this.config[address] })), []);
  }
}

module.exports = StarknetEventConfig;
