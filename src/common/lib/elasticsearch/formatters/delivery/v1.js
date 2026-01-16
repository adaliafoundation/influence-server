const Entity = require('@common/lib/Entity');
const { EntityService } = require('@common/services');

const components = [
  'Control',
  'Delivery',
  'PrivateSale'
];

const v1 = async function (indexItemDoc) {
  const entity = Entity.toEntity(indexItemDoc.identifier);
  const data = await EntityService.getEntity({ components, uuid: entity.uuid, format: true });

  return {
    _id: entity.uuid,
    _index: 'delivery_v1',
    formatted: { id: entity.id, label: entity.label, ...data }
  };
};

module.exports = v1;
