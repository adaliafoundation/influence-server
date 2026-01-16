const entity = require('../../types/entity');

const schema = {
  settings: {
    number_of_shards: 1
  },
  mappings: {
    properties: {
      amount: { type: 'float' },
      crew: entity,
      entity, // exchange
      initialAmount: { type: 'float' },
      locations: {
        type: 'nested',
        ...entity
      },
      makerFee: { type: 'float' },
      orderType: { type: 'integer' },
      product: { type: 'integer' },
      price: { type: 'float' },
      storage: entity,
      storageSlot: { type: 'integer' },
      status: { type: 'byte' },
      validTime: { type: 'date' }
    }
  }
};

module.exports = schema;
