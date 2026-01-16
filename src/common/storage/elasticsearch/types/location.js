const entity = require('./entity');

module.exports = {
  properties: {
    location: entity,
    locations: {
      type: 'nested',
      ...entity
    }
  }
};
