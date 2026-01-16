const entity = require('./entity');

module.exports = {
  properties: {
    permission: { type: 'integer' },
    permitted: entity,
    whitelisted: { type: 'boolean' }
  }
};
