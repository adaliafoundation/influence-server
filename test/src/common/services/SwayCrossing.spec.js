const { expect } = require('chai');
const mongoose = require('mongoose');
const SwayCrossing = require('@common/services/SwayCrossing');

describe('SwayCrossingService', function () {
  afterEach(function () {
    return this.utils.resetCollections(['SwayCrossing']);
  });

  describe('initialize', function () {
    it('should create a SwayCrossing document if one does not exist', async function () {
      const data = {
        toAddress: '0xe88210749f561ccb7839593e99b00414699a80dd',
        amount: '0x1e240',
        fromAddress: '0x0030058f19ed447208015f6430f0102e8ab82d6c291566d7e73fe8e613c3d2ef'
      };
      const event = {
        transactionHash: '0x123456789',
        logIndex: 1,
        timestamp: 1695691834
      };

      const doc = await SwayCrossing.initialize({ data, event });
      expect(doc.pendingCount).to.equal(1);
      expect(doc.events.length).to.equal(1);
      expect(doc.pendingCount).to.equal(1);
    });

    it('should not create a SwayCrossing document if one exists', async function () {
      const data = {
        toAddress: '0xe88210749f561ccb7839593e99b00414699a80dd',
        amount: '0x1e240',
        fromAddress: '0x0030058f19ed447208015f6430f0102e8ab82d6c291566d7e73fe8e613c3d2ef'
      };
      const event = {
        transactionHash: '0x123456789',
        logIndex: 1,
        timestamp: 1695691834
      };

      await SwayCrossing.initialize({ data, event });
      await SwayCrossing.initialize({ data, event });
      await SwayCrossing.initialize({ data, event });

      const docs = await mongoose.model('SwayCrossing').find();
      expect(docs.length).to.equal(1);
    });

    it('should add the sepcified event and increment pendingCount new event', async function () {
      const data = {
        toAddress: '0xe88210749f561ccb7839593e99b00414699a80dd',
        amount: '0x1e240',
        fromAddress: '0x0030058f19ed447208015f6430f0102e8ab82d6c291566d7e73fe8e613c3d2ef'
      };
      const event1 = {
        transactionHash: '0x123456789',
        logIndex: 1,
        timestamp: 1695691834
      };

      const event2 = {
        transactionHash: '0x1234567899',
        logIndex: 1,
        timestamp: 1695691834
      };

      await SwayCrossing.initialize({ data, event: event1 });
      await SwayCrossing.initialize({ data, event: event2 });

      const docs = await mongoose.model('SwayCrossing').find();
      expect(docs.length).to.equal(1);
      expect(docs[0].pendingCount).to.equal(2);
      expect(docs[0].events.length).to.equal(2);
    });

    it('should not add the sepcified event if the event exists in the events array', async function () {
      const data = {
        toAddress: '0xe88210749f561ccb7839593e99b00414699a80dd',
        amount: '0x1e240',
        fromAddress: '0x0030058f19ed447208015f6430f0102e8ab82d6c291566d7e73fe8e613c3d2ef'
      };
      const event = {
        transactionHash: '0x123456789',
        logIndex: 1,
        timestamp: 1695691834
      };

      await SwayCrossing.initialize({ data, event });
      await SwayCrossing.initialize({ data, event });

      const docs = await mongoose.model('SwayCrossing').find();
      expect(docs.length).to.equal(1);
      expect(docs[0].pendingCount).to.equal(1);
      expect(docs[0].events.length).to.equal(1);
    });
  });
});
