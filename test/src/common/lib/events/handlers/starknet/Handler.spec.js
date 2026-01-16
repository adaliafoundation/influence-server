/* eslint-disable max-classes-per-file */
const { expect } = require('chai');
const StarknetBaseHandler = require('@common/lib/events/handlers/starknet/Handler');

describe('StarknetBaseHandler', function () {
  describe('eventName', function () {
    it('should return the correct event name', function () {
      class Handler extends StarknetBaseHandler {
        static eventConfig = { name: 'Foo_Bar' };
      }
      expect(Handler.eventName).to.eql('Foo_Bar');

      Handler.eventConfig.name = 'Foo';
      expect(Handler.eventName).to.eql('Foo');
    });
  });

  describe('baseName', function () {
    it('should return the correct event name', function () {
      class Handler extends StarknetBaseHandler {
        static eventConfig = { name: 'Foo_Bar_V1', baseName: 'Foo_Bar' };
      }
      expect(Handler.baseName).to.eql('Foo_Bar');

      Handler.eventConfig.name = 'Foo';
      expect(Handler.baseName).to.eql('Foo_Bar');

      Handler.eventConfig.baseName = 'Foo';
      expect(Handler.baseName).to.eql('Foo');
    });
  });

  describe('eventNameKey', function () {
    it('should return a joined version of the raw event keys', function () {
      class Handler extends StarknetBaseHandler {
        static eventConfig = { keys: ['0x1', '0x2'] };
      }
      expect(Handler.eventNameKey).to.eql('0x1_0x2');

      Handler.eventConfig.keys = ['0x03'];
      expect(Handler.eventNameKey).to.eql('0x3');

      Handler.eventConfig.keys = ['0x1234', '0x23553'];
      expect(Handler.eventNameKey).to.eql('0x1234_0x23553');

      Handler.eventConfig.keys = ['0x04', '0x5', '0x06'];
      expect(Handler.eventNameKey).to.eql('0x4_0x5_0x6');
    });
  });

  describe('eventVersion', function () {
    it('should return the correct event name', function () {
      class Handler extends StarknetBaseHandler {
        static eventConfig = { version: 1 };
      }
      expect(Handler.eventVersion).to.eql(1);

      Handler.eventConfig.version = 0;
      expect(Handler.eventVersion).to.eql(0);

      Handler.eventConfig.version = undefined;
      expect(Handler.eventVersion).to.eql(0);

      Handler.eventConfig.version = null;
      expect(Handler.eventVersion).to.eql(0);
    });
  });

  describe('parseEvent', function () {
    it('should parse the event correctly', function () {
      class Handler1 extends StarknetBaseHandler {
        static eventConfig = { name: 'Foo', keys: ['0x01'] };

        static transformEventData() {
          return 'returnValues';
        }
      }

      class Handler2 extends StarknetBaseHandler {
        static eventConfig = { name: 'FooV1', baseName: 'Foo', keys: ['0x01'], version: 1 };

        static transformEventData() {
          return 'returnValues';
        }
      }

      class Handler3 extends StarknetBaseHandler {
        static eventConfig = { name: 'FooBar', baseName: 'FooBar', keys: ['0x01', '0x2'] };

        static transformEventData() {
          return 'returnValues';
        }
      }

      class Handler4 extends Handler1 {
        static eventConfig = { name: 'FooBarV2', baseName: 'FooBar', keys: ['0x01', '0x2'], version: 2 };

        static transformEventData() {
          return 'returnValues';
        }
      }

      const event = {
        blockHash: '0x1',
        blockNumber: 1,
        data: 'data',
        from_address: 'from_address',
        keys: 'keys',
        logIndex: 1,
        status: 'status',
        timestamp: 'timestamp',
        txIndex: 1,
        transactionHash: 'transactionHash'
      };

      let eventDoc;

      eventDoc = Handler1.parseEvent(event);
      expect(eventDoc).to.eql({
        ...event,
        event: 'Foo',
        name: 'Foo',
        returnValues: 'returnValues',
        version: 0
      });

      eventDoc = Handler2.parseEvent(event);
      expect(eventDoc).to.eql({
        ...event,
        event: 'FooV1',
        name: 'Foo',
        returnValues: 'returnValues',
        version: 1
      });

      eventDoc = Handler3.parseEvent(event);
      expect(eventDoc).to.eql({
        ...event,
        event: 'FooBar',
        name: 'FooBar',
        returnValues: 'returnValues',
        version: 0
      });

      eventDoc = Handler4.parseEvent(event);
      expect(eventDoc).to.eql({
        ...event,
        event: 'FooBarV2',
        name: 'FooBar',
        returnValues: 'returnValues',
        version: 2
      });
    });
  });
});
