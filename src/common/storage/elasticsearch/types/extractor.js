const entity = require('./entity');

module.exports = {
  properties: {
    destination: entity,
    destinationSlot: { type: 'byte' },
    extractorType: { type: 'byte' },
    finishTime: { type: 'date' },
    outputProduct: { type: 'unsigned_long' },
    slot: { type: 'byte' },
    status: { type: 'byte' },
    yield: { type: 'float' }
  }
};
