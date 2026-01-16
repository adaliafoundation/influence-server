const Entity = require('@common/lib/Entity');
const { ComponentService, EntityService } = require('@common/services');

const components = [
  'Control',
  'Crewmate',
  'Name',
  'Nft'
];

const v1 = async function (indexItemDoc) {
  const entity = Entity.toEntity(indexItemDoc.identifier);
  const data = await EntityService.getEntity({ components, uuid: entity.uuid, format: true });

  // crew name
  const crewNameCompDoc = (data.Control?.controller)
    ? await ComponentService.findOneByEntity('Name', data.Control.controller) : null;

  const meta = { crew: { name: (crewNameCompDoc?.name || null) } };

  return {
    _id: entity.uuid,
    _index: 'crewmate_v1',
    formatted: { id: entity.id, label: entity.label, ...data, meta }
  };
};

module.exports = v1;
