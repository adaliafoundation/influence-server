const ContractAgreement = require('../../types/contract_agreement');
const Control = require('../../types/control');
const entity = require('../../types/entity');
const Location = require('../../types/location');
const PrepaidAgreement = require('../../types/prepaid_agreement');
const WhitelistAgreement = require('../../types/whitelist_agreement');
const WhitelistAccountAgreement = require('../../types/whitelist_account_agreement');

const schema = {
  settings: {
    number_of_shards: 1
  },
  mappings: {
    properties: {
      id: entity.properties.id,
      label: entity.properties.label,
      uuid: entity.properties.uuid,
      ContractAgreements: {
        type: 'nested',
        ...ContractAgreement
      },
      Location,
      meta: {
        properties: {
          asteroid: {
            properties: {
              Control
            }
          }
        }
      },
      PrepaidAgreements: {
        type: 'nested',
        ...PrepaidAgreement
      },
      WhitelistAgreements: {
        type: 'nested',
        ...WhitelistAgreement
      },
      WhitelistAccountAgreements: {
        type: 'nested',
        ...WhitelistAccountAgreement
      }
    }
  }
};

module.exports = schema;
