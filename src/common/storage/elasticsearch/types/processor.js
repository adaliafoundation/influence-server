const entity = require('./entity');

module.exports = {
  properties: {
    destination: entity,
    destinationSlot: { type: 'byte' },
    finishTime: { type: 'date' },
    outputProduct: { type: 'integer' },
    processorType: { type: 'byte' },
    recipes: { type: 'float' },
    runningProcess: { type: 'integer' },
    secondaryEff: { type: 'float' },
    slot: { type: 'byte' },
    status: { type: 'byte' }
  }
};
