const entity = require('../../types/entity');
const Control = require('../../types/control');
const Deposit = require('../../types/deposit');
const Location = require('../../types/location');
const Name = require('../../types/name');
const PrivateSale = require('../../types/private_sale');

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
      Deposit,
      Location,
      PrivateSale,
      meta: {
        properties: {
          asteroid: Name,
          crew: Name
        }
      }
    }
  }
};

module.exports = schema;
