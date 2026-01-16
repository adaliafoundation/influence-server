const { expect } = require('chai');
const starknet = require('starknet');
const { Address } = require('@influenceth/sdk');
const mongoose = require('mongoose');
const { OrderComponentService } = require('@common/services');

describe('OrderComponentService', function () {
  afterEach(function () {
    return this.utils.resetCollections(['Entity', 'OrderComponent']);
  });

  describe('updateInitialCaller', function () {
    it('should update the initial caller, if currently null', async function () {
      const data = {
        entity: { label: 5, id: 1 },
        crew: { label: 1, id: 1 },
        orderType: 1,
        product: 1,
        price: 1,
        storage: { label: 5, id: 2 },
        storageSlot: 1
      };
      const doc = await mongoose.model('OrderComponent').create({
        ...data,
        amount: 1,
        makerFee: 1,
        status: 1,
        validTime: 1
      });

      await OrderComponentService.updateInitialCaller({ ...data, initialCaller: this.GLOBALS.TEST_STARKNET_WALLET });

      const updated = await mongoose.model('OrderComponent').findOne({ _id: doc._id });
      expect(updated.initialCaller).to.equal(this.GLOBALS.TEST_STARKNET_WALLET);
    });

    it('should NOT update the initial caller, if not currently null (replace: false)', async function () {
      const data = {
        entity: { label: 5, id: 1 },
        crew: { label: 1, id: 1 },
        orderType: 1,
        product: 1,
        price: 1,
        storage: { label: 5, id: 2 },
        storageSlot: 1,
        initialCaller: this.GLOBALS.TEST_STARKNET_WALLET
      };
      const doc = await mongoose.model('OrderComponent').create({
        ...data,
        amount: 1,
        makerFee: 1,
        status: 1,
        validTime: 1
      });

      await OrderComponentService.updateInitialCaller({ ...data, initialCaller: '0x123456' }, false);

      const updated = await mongoose.model('OrderComponent').findOne({ _id: doc._id });
      expect(updated.initialCaller).to.equal(this.GLOBALS.TEST_STARKNET_WALLET);
    });

    it('should update the initial caller, if not currently null (replace: true)', async function () {
      const data = {
        entity: { label: 5, id: 1 },
        crew: { label: 1, id: 1 },
        orderType: 1,
        product: 1,
        price: 1,
        storage: { label: 5, id: 2 },
        storageSlot: 1,
        initialCaller: this.GLOBALS.TEST_STARKNET_WALLET
      };
      const doc = await mongoose.model('OrderComponent').create({
        ...data,
        amount: 1,
        makerFee: 1,
        status: 1,
        varidTime: 1
      });

      const address = Address.toStandard(starknet.stark.randomAddress(), 'starknet');
      await OrderComponentService.updateInitialCaller({ ...data, initialCaller: address }, true);

      const updated = await mongoose.model('OrderComponent').findOne({ _id: doc._id });
      expect(updated.initialCaller).to.equal(address);
    });
  });
});
