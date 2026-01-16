const entity = require('./entity');

module.exports = {
  properties: {
    dryDockType: { type: 'byte' },
    finishTime: { type: 'date' },
    outputShip: entity,
    slot: { type: 'byte' },
    status: { type: 'byte' }
  }
};
