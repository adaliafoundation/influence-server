const entity = require('./entity');

module.exports = {
  properties: {
    actionRound: { type: 'unsigned_long' },
    actionTarget: entity,
    actionType: { type: 'byte' },
    actionWeight: { type: 'unsigned_long' },
    delegatedTo: { type: 'keyword' },
    lastFed: { type: 'date' },
    lastReadyAt: { type: 'date' },
    readyAt: { type: 'date' },
    roster: { type: 'unsigned_long' }
  }
};
