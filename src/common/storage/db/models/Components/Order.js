const { Schema, model } = require('mongoose');
const { ChainComponent, EntitySchema } = require('@common/storage/db/schemas');
const { uniquePathPlugin } = require('@common/storage/db/plugins');
const { EntityHelper } = require('@common/storage/db/helpers');
const { Address } = require('../../helpers');

const schema = new Schema([
  ChainComponent, {
    amount: { type: Number },
    crew: { type: EntitySchema, set: EntityHelper.toEntity },
    initialAmount: { type: Number }, // non-original component data
    initialCaller: { type: String, set: Address.toStandard }, // non-original component data
    makerFee: { type: Number },
    orderType: { type: Number },
    product: { type: Number },
    price: { type: Number },
    storage: { type: EntitySchema, set: EntityHelper.toEntity },
    storageSlot: { type: Number },
    status: { type: Number },
    validTime: { type: Number }
  }
], {
  collection: 'Component_Order',
  pluginTags: ['useEntitiesPlugin']
});

schema
  .plugin(
    uniquePathPlugin,
    ['crew.uuid', 'entity.uuid', 'orderType', 'product', 'price', 'storage.uuid', 'storageSlot']
  )
  .index(
    { 'crew.uuid': 1, 'entity.uuid': 1, orderType: 1, product: 1, price: 1, 'storage.uuid': 1, storageSlot: 1 },
    { unique: true }
  );

module.exports = model('OrderComponent', schema);
