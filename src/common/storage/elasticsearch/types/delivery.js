const entity = require('./entity');
const InventoryItem = require('./inventory_item');

module.exports = {
  properties: {
    contents: InventoryItem,
    dest: entity,
    destSlot: { type: 'short' },
    finishTime: { type: 'date' },
    origin: entity,
    originSlot: { type: 'short' },
    status: { type: 'byte' }
  }
};
