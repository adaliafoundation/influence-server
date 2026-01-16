const Building = require('../../types/building');
const ContractAgreement = require('../../types/contract_agreement');
const ContractPolicy = require('../../types/contract_policy');
const Control = require('../../types/control');
const Dock = require('../../types/dock');
const DryDock = require('../../types/drydock');
const entity = require('../../types/entity');
const Exchange = require('../../types/exchange');
const Extractor = require('../../types/extractor');
const Inventory = require('../../types/inventory');
const Location = require('../../types/location');
const Name = require('../../types/name');
const PrepaidAgreement = require('../../types/prepaid_agreement');
const PrepaidPolicy = require('../../types/prepaid_policy');
const Processor = require('../../types/processor');
const PublicPolicy = require('../../types/public_policy');
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
      Building,
      ContractAgreements: {
        type: 'nested',
        ...ContractAgreement
      },
      ContractPolicies: {
        type: 'nested',
        ...ContractPolicy
      },
      Control,
      Dock,
      DryDocks: {
        type: 'nested',
        ...DryDock
      },
      Exchange,
      Extractor,
      Inventories: {
        type: 'nested',
        ...Inventory
      },
      Location,
      meta: {
        properties: {
          asteroid: Name,
          crew: Name,
          lotUser: entity,
          lotOccupation: { type: 'keyword' }
        }
      },
      Name,
      PrepaidAgreements: {
        type: 'nested',
        ...PrepaidAgreement
      },
      PrepaidPolicies: {
        type: 'nested',
        ...PrepaidPolicy
      },
      Processors: {
        type: 'nested',
        ...Processor
      },
      PublicPolicies: {
        type: 'nested',
        ...PublicPolicy
      },
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
