const entity = require('./entity');

module.exports = {
  properties: {
    amount: { type: 'float' },
    exchange: entity,
    orderType: { type: 'short' },
    product: { type: 'unsigned_long' },
    price: { type: 'float' },
    status: { type: 'byte' },
    storage: entity,
    storageSlot: { type: 'short' },
    validTime: { type: 'date' }
  }
};
