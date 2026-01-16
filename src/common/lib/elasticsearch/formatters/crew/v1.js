const Entity = require('@common/lib/Entity');
const { ComponentService, EntityService, NameComponentService } = require('@common/services');

const components = [
  'Crew',
  'Location',
  'Inventory',
  'Name',
  'Nft',
  'Ship'
];

const v1 = async function (indexItemDoc) {
  const entity = Entity.toEntity(indexItemDoc.identifier);
  const data = await EntityService.getEntity({ components, uuid: entity.uuid, format: true });

  // get the full location
  const locationDoc = await ComponentService.findOneByEntity('Location', entity);

  // asteroid name
  const asteroidEntity = locationDoc?.locations?.find((e) => e.label === Entity.IDS.ASTEROID);
  const asteroidNameCompDoc = (asteroidEntity) ? await ComponentService.findOneByEntity('Name', asteroidEntity) : null;

  // building name
  const buildingEntity = locationDoc?.locations?.find((e) => e.label === Entity.IDS.BUILDING);
  const buildingNameCompDoc = (buildingEntity) ? await ComponentService.findOneByEntity('Name', buildingEntity) : null;

  // ship name
  const shipEntity = locationDoc?.locations?.find((e) => e.label === Entity.IDS.SHIP);
  const shipNameCompDoc = (shipEntity) ? await ComponentService.findOneByEntity('Name', shipEntity) : null;

  // crewmates
  const crewmateNameDocs = (data.Crew?.roster) ? await NameComponentService.findByRoster(data.Crew.roster) : null;
  const crewmates = (crewmateNameDocs || []).map((doc) => ({ id: doc.entity.id, name: doc.name }));

  const meta = {
    asteroid: { name: (asteroidNameCompDoc?.name || null) },
    building: { name: (buildingNameCompDoc?.name || null) },
    crewmates,
    ship: { name: (shipNameCompDoc?.name || null) }
  };

  return {
    _id: entity.uuid,
    _index: 'crew_v1',
    formatted: { id: entity.id, label: entity.label, ...data, meta }
  };
};

module.exports = v1;
