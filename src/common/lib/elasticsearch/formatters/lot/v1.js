const Entity = require('@common/lib/Entity');
const { ComponentService, EntityService } = require('@common/services');

const components = [
  'ContractAgreement',
  'PrepaidAgreement',
  'WhitelistAgreement',
  'WhitelistAccountAgreement'
];

const v1 = async function (indexItemDoc) {
  const entity = Entity.toEntity(indexItemDoc.identifier);
  const data = await EntityService.getEntity({ components, uuid: entity.uuid, format: true });

  // Add in a virutal Location component
  const { asteroidEntity } = entity.unpackLot();
  data.Location = {
    location: asteroidEntity,
    locations: [asteroidEntity]
  };
  data.meta = {};

  // get the asteroid controller
  const controlComponentDoc = await ComponentService.findOneByEntity('Control', asteroidEntity);
  if (controlComponentDoc?.controller) {
    Object.assign(data.meta, { asteroid: { Control: { controller: controlComponentDoc.controller } } });
  }

  return {
    _id: entity.uuid,
    _index: 'lot_v1',
    formatted: { id: entity.id, label: entity.label, ...data }
  };
};

module.exports = v1;
