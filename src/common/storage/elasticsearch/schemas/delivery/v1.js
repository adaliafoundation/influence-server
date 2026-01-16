const { properties: { id, label, uuid } } = require('../../types/entity');
const Control = require('../../types/control');
const Delivery = require('../../types/delivery');
const PrivateSale = require('../../types/private_sale');

const schema = {
  settings: {
    number_of_shards: 1
  },
  mappings: {
    properties: {
      id,
      label,
      uuid,
      Control,
      Delivery,
      PrivateSale
    }
  }
};

module.exports = schema;
