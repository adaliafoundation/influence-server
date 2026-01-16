/* eslint-disable max-classes-per-file */
const { expect } = require('chai');
const StarknetEventConfig = require('@common/lib/events/retrievers/starknet/config');
const BaseHandler = require('@common/lib/events/handlers/starknet/Handler');

describe('Starknet Event Config', function () {
  const ADDRESS_NAME_MAP = {
    '0x0000000000000000000000000000000000000000000000000000000000000123': {
      ComponentUpdated_Crewmate: class Handler extends BaseHandler {
        static eventConfig = {
          name: 'ComponentUpdated_Crewmate',
          keys: ['0x11', '0x22']
        };
      }
    },
    '0x124': {
      Transfer: class Handler extends BaseHandler {
        static eventConfig = {
          name: 'Transfer',
          keys: ['0x33']
        };
      }
    }
  };

  describe('config (get)', function () {
    it('should return an event config object', function () {
      const result = StarknetEventConfig.config;
      expect(result).to.be.an('object');
    });
  });

  describe('buildEventsConfig', function () {
    it('should build and set the eventsConfig property', function () {
      StarknetEventConfig.buildEventsConfig(ADDRESS_NAME_MAP);
      expect(StarknetEventConfig._eventsConfig).to.be.an('object');
      expect(StarknetEventConfig
        ._eventsConfig['0x0000000000000000000000000000000000000000000000000000000000000123']).to.be.an('object');
    });
  });

  describe('getHandler', function () {
    it('should return a handler for a given event', function () {
      StarknetEventConfig.buildEventsConfig(ADDRESS_NAME_MAP);
      const event = {
        address: '0x123',
        keys: ['0x11', '0x22']
      };
      const handler = StarknetEventConfig.getHandler(event);
      expect(handler).to.be.an('function');
      expect(handler.eventConfig.name).to.eql('ComponentUpdated_Crewmate');
    });
  });
});
