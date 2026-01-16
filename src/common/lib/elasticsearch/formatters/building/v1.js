const Entity = require('@common/lib/Entity');
const { ComponentService, EntityService, LotService } = require('@common/services');

const components = [
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
];

const v1 = async function (indexItemDoc) {
  const entity = Entity.toEntity(indexItemDoc.identifier);
  const data = await EntityService.getEntity({ components, uuid: entity.uuid, format: true });

  // get the building's full location
  const locationDoc = await ComponentService.findOneByEntity('Location', entity);
  const lotEntity = locationDoc?.locations.find((e) => e.label === Entity.IDS.LOT);
  const asteroidEntity = locationDoc?.locations.find((e) => e.label === Entity.IDS.ASTEROID);
  const buildingControllerEntity = data.Control?.controller;

  // get the lotUser
  const lotUseEntity = (lotEntity) ? await LotService.getLotUseEntity(lotEntity) : null;

  // get the lotOccupation
  const lotOccupation = await LotService.getLotOccupation(lotUseEntity, asteroidEntity, buildingControllerEntity);

  // asteroid name
  const asteroidNameCompDoc = (asteroidEntity) ? await ComponentService.findOneByEntity('Name', asteroidEntity) : null;

  // crew name
  const crewNameCompDoc = (data.Control?.controller) ? await ComponentService
    .findOneByEntity('Name', data.Control.controller) : null;

  const meta = {
    asteroid: { name: (asteroidNameCompDoc?.name || null) },
    crew: { name: (crewNameCompDoc?.name || null) },
    lotOccupation,
    lotUser: lotUseEntity
  };

  return {
    _id: entity.uuid,
    _index: 'building_v1',
    formatted: { id: entity.id, label: entity.label, ...data, meta }
  };
};

module.exports = v1;
