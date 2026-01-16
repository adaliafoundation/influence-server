const { expect } = require('chai');
const mongoose = require('mongoose');
const { omit } = require('lodash');
const moment = require('moment');
const { ComponentService } = require('@common/services');

describe('ComponentService', function () {
  describe('updateOrCreateFromEvent', function () {
    afterEach(function () {
      return this.utils.resetCollections(['BuildingComponent', 'Entity', 'Event']);
    });

    it('should create a new document', async function () {
      const event = await mongoose.model('Starknet').create({
        blockHash: '0x123',
        blockNumber: 1,
        event: 'ComponentUpdated_Building',
        logIndex: 1,
        name: 'ComponentUpdated_Building',
        timestamp: moment().unix(),
        transactionHash: '0x123',
        transactionIndex: 1
      });

      const component = 'Building';

      const data = {
        entity: { id: 1, label: 5 },
        buildingType: 1,
        finishTime: moment().unix(),
        status: 1,
        plannedAt: moment().unix()
      };

      const { doc, filter } = await ComponentService.updateOrCreateFromEvent({ event, component, data });
      expect(filter).to.be.a('object');
      expect(doc).to.be.a('object');
    });

    it('should update the existing document, not replace (replace: false)', async function () {
      const event1 = await mongoose.model('Starknet').create({
        blockHash: '0x123',
        blockNumber: 1,
        event: 'ComponentUpdated_Building',
        logIndex: 1,
        name: 'ComponentUpdated_Building',
        timestamp: moment().unix(),
        transactionHash: '0x123',
        transactionIndex: 1
      });

      const event2 = await mongoose.model('Starknet').create({
        ...omit(event1.toJSON(), 'id'),
        blockNumber: 2,
        timestamp: moment().unix() + 1,
        transactionHash: '0x124'
      });

      const component = 'Building';

      const data = {
        entity: { id: 1, label: 5 },
        buildingType: 1,
        finishTime: moment().unix(),
        status: 1,
        plannedAt: moment().unix()
      };

      await ComponentService.updateOrCreateFromEvent({ event: event1, component, data });
      const { doc } = await ComponentService.updateOrCreateFromEvent({
        event: event2,
        component,
        data: {
          entity: { id: 1, label: 5 },
          status: 2
        },
        replace: false
      });

      expect(doc.event.id.toString()).to.equal(event2.id.toString());
      expect(doc.status).to.equal(2);
      expect(doc.buildingType).to.equal(data.buildingType);
      expect(doc.finishTime).to.equal(data.finishTime);
      expect(doc.plannedAt).to.equal(data.plannedAt);
    });

    it('should replace the existing document (replace: true)', async function () {
      const event1 = await mongoose.model('Starknet').create({
        blockHash: '0x123',
        blockNumber: 1,
        event: 'ComponentUpdated_Building',
        logIndex: 1,
        name: 'ComponentUpdated_Building',
        timestamp: moment().unix(),
        transactionHash: '0x123',
        transactionIndex: 1
      });

      const event2 = await mongoose.model('Starknet').create({
        ...omit(event1.toJSON(), 'id'),
        blockNumber: 2,
        timestamp: moment().unix() + 1,
        transactionHash: '0x124'
      });

      const component = 'Building';

      const data = {
        entity: { id: 1, label: 5 },
        buildingType: 1,
        finishTime: moment().unix(),
        status: 1,
        plannedAt: moment().unix()
      };

      await ComponentService.updateOrCreateFromEvent({ event: event1, component, data });
      const { doc } = await ComponentService.updateOrCreateFromEvent({
        event: event2,
        component,
        data: {
          entity: { id: 1, label: 5 },
          status: 2
        },
        replace: true
      });

      expect(doc.event.id.toString()).to.equal(event2.id.toString());
      expect(doc.status).to.equal(2);
      expect(doc.buildingType).to.equal(undefined);
      expect(doc.finishTime).to.equal(undefined);
      expect(doc.plannedAt).to.equal(undefined);
    });

    it('should not update if the event is "older" than the existing event (v1)', async function () {
      const timestamp = moment().unix();
      const event1 = await mongoose.model('Starknet').create({
        blockHash: '0x123',
        blockNumber: 5,
        event: 'ComponentUpdated_Building',
        logIndex: 1,
        name: 'ComponentUpdated_Building',
        timestamp,
        transactionHash: '0x123',
        transactionIndex: 1
      });

      const event2 = await mongoose.model('Starknet').create({
        ...omit(event1.toJSON(), 'id'),
        blockNumber: 4,
        timestamp: timestamp - 1,
        transactionHash: '0x124'
      });

      const component = 'Building';

      const data = {
        entity: { id: 1, label: 5 },
        buildingType: 1,
        finishTime: moment().unix(),
        status: 1,
        plannedAt: moment().unix()
      };

      await ComponentService.updateOrCreateFromEvent({ event: event1, component, data });
      const { doc } = await ComponentService.updateOrCreateFromEvent({
        event: event2,
        component,
        data: {
          entity: { id: 1, label: 5 },
          status: 2
        },
        replace: true
      });

      expect(doc.event.id.toString()).to.equal(event1.id.toString());
    });

    it('should not update if the event is "older" than the existing event (v2)', async function () {
      const timestamp = moment().unix();
      const event1 = await mongoose.model('Starknet').create({
        blockHash: '0x123',
        blockNumber: 1,
        event: 'ComponentUpdated_Building',
        logIndex: 1,
        name: 'ComponentUpdated_Building',
        timestamp,
        transactionHash: '0x123',
        transactionIndex: 2
      });

      const event2 = await mongoose.model('Starknet').create({
        ...omit(event1.toJSON(), 'id'),
        blockNumber: 1,
        timestamp,
        transactionHash: '0x124',
        transactionIndex: 1
      });

      const component = 'Building';

      const data = {
        entity: { id: 1, label: 5 },
        buildingType: 1,
        finishTime: moment().unix(),
        status: 1,
        plannedAt: moment().unix()
      };

      await ComponentService.updateOrCreateFromEvent({ event: event1, component, data });
      const { doc } = await ComponentService.updateOrCreateFromEvent({
        event: event2,
        component,
        data: {
          entity: { id: 1, label: 5 },
          status: 2
        },
        replace: true
      });

      expect(doc.event.id.toString()).to.equal(event1.id.toString());
    });

    it('should not update if the event is "older" than the existing event (v3)', async function () {
      const timestamp = moment().unix();
      const event1 = await mongoose.model('Starknet').create({
        blockHash: '0x123',
        blockNumber: 1,
        event: 'ComponentUpdated_Building',
        logIndex: 1,
        name: 'ComponentUpdated_Building',
        timestamp,
        transactionHash: '0x123',
        transactionIndex: 2
      });

      const event2 = await mongoose.model('Starknet').create({
        ...omit(event1.toJSON(), 'id'),
        blockNumber: 1,
        logIndex: 0,
        timestamp,
        transactionHash: '0x124',
        transactionIndex: 2
      });

      const component = 'Building';

      const data = {
        entity: { id: 1, label: 5 },
        buildingType: 1,
        finishTime: moment().unix(),
        status: 1,
        plannedAt: moment().unix()
      };

      await ComponentService.updateOrCreateFromEvent({ event: event1, component, data });
      const { doc } = await ComponentService.updateOrCreateFromEvent({
        event: event2,
        component,
        data: {
          entity: { id: 1, label: 5 },
          status: 2
        },
        replace: true
      });

      expect(doc.event.id.toString()).to.equal(event1.id.toString());
    });

    it('should not update if the event is "older" than the existing event (v4)', async function () {
      const timestamp = moment().unix();
      const event1 = await mongoose.model('Starknet').create({
        blockHash: '0x123',
        blockNumber: 5,
        event: 'ComponentUpdated_Building',
        logIndex: 1,
        name: 'ComponentUpdated_Building',
        timestamp,
        transactionHash: '0x123',
        transactionIndex: 1
      });

      const event2 = await mongoose.model('Starknet').create({
        ...omit(event1.toJSON(), 'id'),
        blockNumber: 4,
        logIndex: 2,
        transactionIndex: 2,
        timestamp: timestamp - 10,
        transactionHash: '0x124'
      });

      const component = 'Building';

      const data = {
        entity: { id: 1, label: 5 },
        buildingType: 1,
        finishTime: moment().unix(),
        status: 1,
        plannedAt: moment().unix()
      };

      await ComponentService.updateOrCreateFromEvent({ event: event1, component, data });
      const { doc } = await ComponentService.updateOrCreateFromEvent({
        event: event2,
        component,
        data: {
          entity: { id: 1, label: 5 },
          status: 2
        },
        replace: true
      });

      expect(doc.event.id.toString()).to.equal(event1.id.toString());
    });

    it('should update if the event is "newer" than the existing event (v1)', async function () {
      const event1 = await mongoose.model('Starknet').create({
        blockHash: '0x123',
        blockNumber: 1,
        event: 'ComponentUpdated_Building',
        logIndex: 1,
        name: 'ComponentUpdated_Building',
        timestamp: moment().unix(),
        transactionHash: '0x123',
        transactionIndex: 1
      });

      const event2 = await mongoose.model('Starknet').create({
        ...omit(event1.toJSON(), 'id'),
        blockNumber: 2,
        timestamp: moment().unix() + 1,
        transactionHash: '0x124'
      });

      const component = 'Building';

      const data = {
        entity: { id: 1, label: 5 },
        buildingType: 1,
        finishTime: moment().unix(),
        status: 1,
        plannedAt: moment().unix()
      };

      await ComponentService.updateOrCreateFromEvent({ event: event1, component, data });
      const { doc } = await ComponentService.updateOrCreateFromEvent({
        event: event2,
        component,
        data: {
          entity: { id: 1, label: 5 },
          status: 2
        },
        replace: false
      });

      expect(doc.event.id.toString()).to.equal(event2.id.toString());
    });

    it('should update if the event is "newer" than the existing event (v2)', async function () {
      const event1 = await mongoose.model('Starknet').create({
        blockHash: '0x123',
        blockNumber: 1,
        event: 'ComponentUpdated_Building',
        logIndex: 1,
        name: 'ComponentUpdated_Building',
        timestamp: moment().unix(),
        transactionHash: '0x123',
        transactionIndex: 1
      });

      const event2 = await mongoose.model('Starknet').create({
        ...omit(event1.toJSON(), 'id'),
        blockNumber: 1,
        timestamp: moment().unix() + 1,
        transactionHash: '0x124',
        transactionIndex: 2
      });

      const component = 'Building';

      const data = {
        entity: { id: 1, label: 5 },
        buildingType: 1,
        finishTime: moment().unix(),
        status: 1,
        plannedAt: moment().unix()
      };

      await ComponentService.updateOrCreateFromEvent({ event: event1, component, data });
      const { doc } = await ComponentService.updateOrCreateFromEvent({
        event: event2,
        component,
        data: {
          entity: { id: 1, label: 5 },
          status: 2
        },
        replace: false
      });

      expect(doc.event.id.toString()).to.equal(event2.id.toString());
    });

    it('should update if the event is "newer" than the existing event (v3)', async function () {
      const event1 = await mongoose.model('Starknet').create({
        blockHash: '0x123',
        blockNumber: 1,
        event: 'ComponentUpdated_Building',
        logIndex: 1,
        name: 'ComponentUpdated_Building',
        timestamp: moment().unix(),
        transactionHash: '0x123',
        transactionIndex: 1
      });

      const event2 = await mongoose.model('Starknet').create({
        ...omit(event1.toJSON(), 'id'),
        blockNumber: 1,
        logIndex: 2,
        timestamp: moment().unix() + 1,
        transactionHash: '0x124',
        transactionIndex: 1
      });

      const component = 'Building';

      const data = {
        entity: { id: 1, label: 5 },
        buildingType: 1,
        finishTime: moment().unix(),
        status: 1,
        plannedAt: moment().unix()
      };

      await ComponentService.updateOrCreateFromEvent({ event: event1, component, data });
      const { doc } = await ComponentService.updateOrCreateFromEvent({
        event: event2,
        component,
        data: {
          entity: { id: 1, label: 5 },
          status: 2
        },
        replace: false
      });

      expect(doc.event.id.toString()).to.equal(event2.id.toString());
    });

    it('should update if the event is "newer" than the existing event (v4)', async function () {
      const event1 = await mongoose.model('Starknet').create({
        data: [
          '0x2', '0x6bb0005',
          '0x1', '0x1',
          '0x0', '0x0',
          '0x0', '0x0',
          '0x0', '0x0',
          '0x0'
        ],
        keys: [
          '0x297be67eb977068ccd2304c6440368d4a6114929aeb860c98b6a7e91f96e2ef',
          '0x457874726163746f72'
        ],
        name: 'ComponentUpdated_Extractor',
        status: 'ACCEPTED_ON_L1',
        version: 0,
        address: '0x0422d33a3638dcc4c62e72e1d6942cd31eb643ef596ccac2351e0e21f6cd4bf4',
        blockHash: '0x35e8aed3a2b62d286d150b17c390687fcb9d4179a39784cd6445c58447fefa5',
        blockNumber: 654516,
        event: 'ComponentUpdated_Extractor',
        ignore: false,
        logIndex: 1,
        removed: false,
        returnValues: {
          entity: { label: 5, id: 1723 },
          slot: 1,
          extractorType: 1,
          status: 0,
          outputProduct: 0,
          yield: 0,
          destination: null,
          destinationSlot: 0,
          finishTime: 0
        },
        timestamp: 1720000112,
        transactionHash: '0x039367cea80be5e911709eaaaec210e774df36df29c060610470b5b773e9bc20',
        transactionIndex: 85
      });

      const event2 = await mongoose.model('Starknet').create({
        data: [
          '0x2', '0x6bb0005',
          '0x1', '0x1',
          '0x1', '0x1',
          '0x46396', '0x5',
          '0x409', '0x2',
          '0x6685b54c'
        ],
        keys: [
          '0x297be67eb977068ccd2304c6440368d4a6114929aeb860c98b6a7e91f96e2ef',
          '0x457874726163746f72'
        ],
        name: 'ComponentUpdated_Extractor',
        status: 'ACCEPTED_ON_L1',
        version: 0,
        address: '0x0422d33a3638dcc4c62e72e1d6942cd31eb643ef596ccac2351e0e21f6cd4bf4',
        blockHash: '0x35e8aed3a2b62d286d150b17c390687fcb9d4179a39784cd6445c58447fefa5',
        blockNumber: 654516,
        event: 'ComponentUpdated_Extractor',
        ignore: false,
        logIndex: 2,
        removed: false,
        returnValues: {
          entity: { label: 5, id: 1723 },
          slot: 1,
          extractorType: 1,
          status: 1,
          outputProduct: 1,
          yield: 287638,
          destination: { label: 5, id: 1033 },
          destinationSlot: 2,
          finishTime: 1720038732
        },
        timestamp: 1720000112,
        transactionHash: '0x00939ee5fccece6de66fd3e8777f349efd2ba129d7c0a80e0c0fe69539d183e4',
        transactionIndex: 259
      });

      const component = 'Extractor';
      await ComponentService.updateOrCreateFromEvent({ event: event1, component, data: { ...event1.returnValues } });
      const { doc } = await ComponentService.updateOrCreateFromEvent({
        event: event2, component, data: { ...event2.returnValues }
      });

      expect(doc.event.id.toString()).to.equal(event2.id.toString());
    });

    it('should rely on timestamps if the events are from different chains', async function () {
      const starknetEvent = await mongoose.model('Starknet').create({
        blockHash: '0x123',
        blockNumber: 500,
        event: 'SomeStarknetEvent',
        logIndex: 1,
        name: 'SomeStarknetEvent',
        timestamp: moment().unix() + 1,
        transactionHash: '0x123',
        transactionIndex: 1
      });

      const ethEvent = await mongoose.model('Ethereum').create({
        blockHash: '0x1234',
        blockNumber: 100000000,
        event: 'SomeEthereumEvent',
        logIndex: 1,
        name: 'SomeEthereumEvent',
        timestamp: moment().unix(),
        transactionHash: '0x1245',
        transactionIndex: 1
      });

      const component = 'Building';

      const data = {
        entity: { id: 1, label: 5 },
        buildingType: 1,
        finishTime: moment().unix(),
        status: 1,
        plannedAt: moment().unix()
      };

      await ComponentService.updateOrCreateFromEvent({ event: ethEvent, component, data });

      const { created, doc, updated } = await ComponentService.updateOrCreateFromEvent({
        event: starknetEvent,
        component,
        data: {
          entity: { id: 1, label: 5 },
          status: 2
        },
        replace: true
      });

      expect(doc.event.id.toString()).to.equal(starknetEvent.id.toString());
      expect(doc.status).to.equal(2);
      expect(created).to.equal(false);
      expect(updated).to.equal(true);
    });
  });
});
