const moment = require('moment');
const { Entity } = require('@influenceth/sdk');
const { castArray, compact } = require('lodash');

const componentConfig = {
  ContractAgreement: { isArray: true, name: 'ContractAgreements' },
  ContractPolicy: { isArray: true, name: 'ContractPolicies' },
  Delivery: {
    components: [
      { component: 'Location', lf: 'dest.uuid', as: 'dest.Location', isArray: false },
      { component: 'Location', lf: 'origin.uuid', as: 'origin.Location', isArray: false }
    ]
  },
  DryDock: { isArray: true, name: 'DryDocks' },
  Extractor: { isArray: true, name: 'Extractors' },
  Inventory: { isArray: true, name: 'Inventories' },
  PrepaidAgreement: {
    isArray: true,
    name: 'PrepaidAgreements',
    filter() {
      return {
        $match: { endTime: { $gte: moment().subtract(7, 'days').unix() } }
      };
    }
  },
  PrepaidPolicy: { isArray: true, name: 'PrepaidPolicies' },
  Processor: { isArray: true, name: 'Processors' },
  PublicPolicy: { isArray: true, name: 'PublicPolicies' },
  WhitelistAgreement: { isArray: true, name: 'WhitelistAgreements' },
  WhitelistAccountAgreement: { isArray: true, name: 'WhitelistAccountAgreements' }
};

const config = {
  Asteroid: {
    components: [
      'AsteroidProof',
      'AsteroidReward',
      'Control',
      'Celestial',
      'ContractPolicy',
      'Name',
      'Nft',
      'Orbit',
      'PrepaidMerklePolicy',
      'PrepaidPolicy',
      'PublicPolicy'
    ],
    type: Entity.IDS.ASTEROID
  },
  Building: {
    components: [
      'Building',
      'ContractAgreement',
      'ContractPolicy',
      'Control',
      'Dock',
      'DryDock',
      'Exchange',
      'Extractor',
      'Inventory',
      'Location',
      'Name',
      'PrepaidAgreement',
      'PrepaidPolicy',
      'Processor',
      'PublicPolicy',
      'Station',
      'WhitelistAgreement',
      'WhitelistAccountAgreement'
    ],
    type: Entity.IDS.BUILDING
  },
  Crew: {
    components: [
      'Crew',
      'Location',
      'Inventory',
      'Name',
      'Nft',
      'Ship'
    ],
    type: Entity.IDS.CREW
  },
  Crewmate: {
    components: [
      'Control',
      'Crewmate',
      'Name',
      'Nft'
    ],
    type: Entity.IDS.CREWMATE
  },
  Delivery: {
    components: [
      'Control',
      'Delivery',
      'PrivateSale'
    ],
    type: Entity.IDS.DELIVERY
  },
  Deposit: {
    components: [
      'Control',
      'Deposit',
      'Location',
      'PrivateSale'
    ],
    type: Entity.IDS.DEPOSIT
  },
  Lot: {
    components: [
      'ContractAgreement',
      'PrepaidAgreement',
      'WhitelistAgreement',
      'WhitelistAccountAgreement'
    ],
    type: Entity.IDS.LOT
  },
  Ship: {
    components: [
      'ContractAgreement',
      'ContractPolicy',
      'Control',
      'Inventory',
      'Location',
      'Name',
      'Nft',
      'PrepaidAgreement',
      'PrepaidPolicy',
      'PublicPolicy',
      'Ship',
      'Station',
      'WhitelistAgreement',
      'WhitelistAccountAgreement'
    ],
    type: Entity.IDS.SHIP
  },
  Space: {
    components: ['Name'],
    type: Entity.IDS.SPACE
  }
};

const getByLabel = function (label, componentNames = []) {
  // if no label is provided, format specified component names as an array of objects
  if (!label) {
    return {
      components: compact(castArray(componentNames)).map((component) => {
        if (componentConfig[component]) return { component, ...componentConfig[component] };
        return { component };
      })
    };
  }

  const _config = Object.values(config).find(({ type }) => type === Number(label));
  if (!_config) throw new Error(`No config found for ${label}`);

  const userSelected = compact(castArray(componentNames));
  const components = (userSelected.length > 0) ? userSelected : _config.components;

  return {
    components: components.map((component) => {
      if (componentConfig[component]) return { component, ...componentConfig[component] };
      return { component };
    })
  };
};

module.exports = {
  config,
  getByLabel
};
