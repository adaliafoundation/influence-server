const Crew = require('../../types/crew');
const entity = require('../../types/entity');
const Location = require('../../types/location');
const Inventory = require('../../types/inventory');
const Name = require('../../types/name');
const Nft = require('../../types/nft');
const Ship = require('../../types/ship');

const schema = {
  settings: {
    number_of_shards: 1
  },
  mappings: {
    properties: {
      id: entity.properties.id,
      label: entity.properties.label,
      uuid: entity.properties.uuid,
      Crew,
      Location,
      Inventories: {
        type: 'nested',
        ...Inventory
      },
      meta: {
        properties: {
          asteroid: Name,
          building: Name,
          crewmates: {
            properties: {
              id: entity.properties.id,
              name: Name.properties.name
            }
          },
          ship: Name
        }
      },
      Name,
      Nft,
      Ship
    }
  }
};

module.exports = schema;
