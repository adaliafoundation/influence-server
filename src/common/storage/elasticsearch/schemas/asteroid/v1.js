const Celestial = require('../../types/celestial');
const ContractPolicy = require('../../types/contract_policy');
const Control = require('../../types/control');
const { properties: { id, label, uuid } } = require('../../types/entity');
const Name = require('../../types/name');
const Nft = require('../../types/nft');
const Orbit = require('../../types/orbit');
const PrepaidPolicy = require('../../types/prepaid_policy');
const PrepaidMerklePolicy = require('../../types/prepaid_merkle_policy');
const PublicPolicy = require('../../types/public_policy');

const schema = {
  settings: {
    number_of_shards: 1
  },
  mappings: {
    properties: {
      id,
      label,
      uuid,
      Celestial,
      ContractPolicies: {
        type: 'nested',
        ...ContractPolicy
      },
      Control,
      meta: {
        properties: {
          buildingCount: { type: 'long' },
          crewCount: { type: 'long' },
          shipCount: { type: 'long' }
        }
      },
      Name,
      Nft,
      Orbit,
      PrepaidMerklePolicy: {
        type: 'nested',
        ...PrepaidMerklePolicy
      },
      PrepaidPolicies: {
        type: 'nested',
        ...PrepaidPolicy
      },
      PublicPolicies: {
        type: 'nested',
        ...PublicPolicy
      }
    }
  }
};

module.exports = schema;
