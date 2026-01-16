const inventoryItem = require('./inventory_item');

module.exports = {
  properties: {
    contents: inventoryItem,
    inventoryType: { type: 'byte' },
    mass: { type: 'float' },
    slot: { type: 'byte' },
    status: { type: 'byte' },
    reservedMass: { type: 'float' },
    reservedVolume: { type: 'float' },
    volume: { type: 'float' }
  }
};
