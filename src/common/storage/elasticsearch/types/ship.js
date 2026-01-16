const entity = require('./entity');

module.exports = {
  properties: {
    emergencyAt: { type: 'date' },
    readyAt: { type: 'date' },
    shipType: { type: 'byte' },
    status: { type: 'byte' },
    transitArrival: { type: 'date' },
    transitDeparture: { type: 'date' },
    transitDestination: entity,
    transitOrigin: entity,
    variant: { type: 'byte' }
  }
};
