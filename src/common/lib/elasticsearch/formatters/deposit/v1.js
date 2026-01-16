const Entity = require('@common/lib/Entity');
const { ComponentService, EntityService } = require('@common/services');

const components = [
  'Control',
  'Deposit',
  'Location',
  'PrivateSale'
];

const v1 = async function (indexItemDoc) {
  const entity = Entity.toEntity(indexItemDoc.identifier);
  const data = await EntityService.getEntity({ components, uuid: entity.uuid, format: true });

  // get the full location
  const locationDoc = await ComponentService.findOneByEntity('Location', entity);

  // asteroid name
  const asteroidEntity = locationDoc?.locations?.find((e) => e.label === Entity.IDS.ASTEROID);
  const asteroidNameCompDoc = (asteroidEntity) ? await ComponentService.findOneByEntity('Name', asteroidEntity) : null;

  // crew name
  const crewNameCompDoc = (data.Control?.controller) ? await ComponentService
    .findOneByEntity('Name', data.Control.controller) : null;

  const meta = {
    asteroid: { name: (asteroidNameCompDoc?.name || null) },
    crew: { name: (crewNameCompDoc?.name || null) }
  };

  return {
    _id: entity.uuid,
    _index: 'deposit_v1',
    formatted: { id: entity.id, label: entity.label, ...data, meta }
  };
};

module.exports = v1;
