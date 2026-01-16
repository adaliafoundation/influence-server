const { expect } = require('chai');
const { forEach } = require('lodash');
const { Address } = require('@influenceth/sdk');
const EventProcessorConfig = require('@common/lib/events/processor/config');
const handlers = require('@common/lib/events/handlers');

const {
  env: {
    CONTRACT_ASTEROID_TOKEN = '0x01',
    CONTRACT_CREW_TOKEN = '0x02',
    STARKNET_CONTRACT_DISPATCHER = '0x03'
  }
} = process;

const configuredAddressEventMap = {
  [CONTRACT_ASTEROID_TOKEN]: handlers.ethereum.AsteroidToken,
  [CONTRACT_CREW_TOKEN]: handlers.ethereum.CrewToken,
  [STARKNET_CONTRACT_DISPATCHER]: handlers.starknet.Dispatcher
};

describe('Event Processor config', function () {
  describe('buildHandlerConfig', function () {
    it('should return a configuration keyed by address', function () {
      EventProcessorConfig.buildHandlerConfig(configuredAddressEventMap);
      expect(EventProcessorConfig.config).to.be.a('object');
    });
  });

  describe('getHandlerByAddressAndEvent', function () {
    it('should return the correct handler for the specified address and event', function () {
      let handler;
      EventProcessorConfig.buildHandlerConfig(configuredAddressEventMap);
      handler = EventProcessorConfig.getHandlerByAddressAndEvent({
        address: CONTRACT_ASTEROID_TOKEN,
        eventName: 'Transfer'
      });
      expect(handler).to.be.a('function');

      handler = EventProcessorConfig.getHandlerByAddressAndEvent({
        address: STARKNET_CONTRACT_DISPATCHER,
        eventName: 'ComponentUpdated_Building'
      });

      expect(handler).to.be.a('function');
    });
  });

  describe('config (get)', function () {
    it('should return a configuration', function () {
      const addrStd = Address.toStandard(STARKNET_CONTRACT_DISPATCHER);
      expect(EventProcessorConfig.config[addrStd]).to.be.a('object');
      forEach(EventProcessorConfig.config[addrStd], (handler, eventName) => {
        expect(handler).to.be.a('function');
        expect(eventName).to.be.a('string');
      });
    });
  });
});
