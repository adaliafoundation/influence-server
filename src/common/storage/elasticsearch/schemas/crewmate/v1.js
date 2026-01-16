const Control = require('../../types/control');
const Crewmate = require('../../types/crewmate');
const entity = require('../../types/entity');
const Name = require('../../types/name');
const Nft = require('../../types/nft');

const schema = {
  settings: {
    number_of_shards: 1
  },
  mappings: {
    properties: {
      id: entity.properties.id,
      label: entity.properties.label,
      uuid: entity.properties.uuid,
      Control,
      Crewmate,
      meta: {
        properties: {
          crew: Name
        }
      },
      Name,
      Nft
    }
  }
};

module.exports = schema;
