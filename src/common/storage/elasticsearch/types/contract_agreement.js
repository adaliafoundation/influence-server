const entity = require('./entity');

module.exports = {
  properties: {
    permission: { type: 'integer' },
    permitted: entity,
    address: { type: 'keyword' }
  }
};
