const Entity = require('@common/lib/Entity');
const { EntityService } = require('@common/services');

const components = [
  'Celestial',
  'ContractPolicy',
  'Control',
  'Name',
  'Nft',
  'Orbit',
  'PrepaidMerklePolicy',
  'PrepaidPolicy',
  'PublicPolicy'
];

const v1 = async function (indexItemDoc) {
  const entity = Entity.toEntity(indexItemDoc.identifier);
  const data = await EntityService.getEntity({ components, uuid: entity.uuid, format: true });

  // Commenting out the following counts because they are not currently used
  const meta = {
    // buildingCount: await BuildingService.getCountForAsteroid({ id: 1, label: 3 }),
    // crewCount: await CrewService.getCountForAsteroid({ id: 1, label: 3 }),
    // shipCount: await ShipService.getCountForAsteroid({ id: 1, label: 3 })
  };

  return {
    _id: entity.uuid,
    _index: 'asteroid_v1',
    formatted: { id: entity.id, label: entity.label, ...data, meta }
  };
};

module.exports = v1;
