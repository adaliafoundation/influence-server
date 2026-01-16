const ContractAgreement = require('../../types/contract_agreement');
const ContractPolicy = require('../../types/contract_policy');
const Control = require('../../types/control');
const entity = require('../../types/entity');
const Inventory = require('../../types/inventory');
const Location = require('../../types/location');
const Name = require('../../types/name');
const Nft = require('../../types/nft');
const PrepaidAgreement = require('../../types/prepaid_agreement');
const PrepaidPolicy = require('../../types/prepaid_policy');
const PublicPolicy = require('../../types/public_policy');
const Ship = require('../../types/ship');
const Station = require('../../types/station');
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
      ContractPolicies: {
        type: 'nested',
        ...ContractPolicy
      },
      Control,
      Inventories: {
        type: 'nested',
        ...Inventory
      },
      Location,
      meta: {
        properties: {
          asteroid: Name,
          building: Name,
          crew: Name
        }
      },
      Name,
      Nft,
      PrepaidAgreements: {
        type: 'nested',
        ...PrepaidAgreement
      },
      PrepaidPolicies: {
        type: 'nested',
        ...PrepaidPolicy
      },
      PublicPolicies: {
        type: 'nested',
        ...PublicPolicy
      },
      Ship,
      Station,
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
