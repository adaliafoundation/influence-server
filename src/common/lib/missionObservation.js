const { Building, Entity } = require('@influenceth/sdk');
const { felt, subjectFromUuid } = require('./missions');

// Targets describe the native action's relevant entity, not the beneficiary of its rewards.
const observationSystems = {
  ConstructionPlan: { label: Entity.IDS.LOT, starter: [] },
  ConstructionStart: { label: Entity.IDS.BUILDING, starter: [], colony: true },
  ConstructionFinish: { label: Entity.IDS.BUILDING, starter: [], colony: true },
  SampleDepositStart: { label: Entity.IDS.LOT, starter: [1] },
  SampleDepositFinish: { label: Entity.IDS.DEPOSIT, starter: [1] },
  ExtractResourceStart: { label: Entity.IDS.BUILDING, starter: [2, 3] },
  ExtractResourceFinish: { label: Entity.IDS.BUILDING, starter: [2, 3] },
  ProcessProductsStart: { label: Entity.IDS.BUILDING, starter: [] },
  ProcessProductsFinish: { label: Entity.IDS.BUILDING, starter: [] },
  SendDelivery: { label: null, starter: [7] },
  ReceiveDelivery: { label: Entity.IDS.DELIVERY, starter: [3, 7] },
  ResupplyFood: { label: null, starter: [7] },
  FillSellOrder: { label: Entity.IDS.BUILDING, starter: [3, 7], colony: 3 },
  FillBuyOrder: { label: Entity.IDS.BUILDING, colony: 3 },
  ScanSurfaceStart: { label: Entity.IDS.ASTEROID, colony: 0 },
  ScanSurfaceFinish: { label: Entity.IDS.ASTEROID, colony: 0 },
  StationCrew: { label: Entity.IDS.BUILDING, colony: 1 },
  DockShip: { label: Entity.IDS.BUILDING, colony: 2 }
};

const entityId = (value) => {
  const id = felt(value);
  if (id === '0' || BigInt(id) >= 2n ** 64n) throw new Error('Invalid entity ID');
  return id;
};

const observationInput = (query) => {
  if (typeof query.system !== 'string' || !Object.hasOwn(observationSystems, query.system)) {
    throw new Error('Unsupported observation system');
  }
  const definition = observationSystems[query.system];
  const target = subjectFromUuid(query.targetUuid);
  if (definition.label && target.label !== definition.label) throw new Error('Invalid observation target');
  const crewId = query.crewId === undefined ? null : entityId(query.crewId);
  let buildingType;
  if (query.system === 'ConstructionPlan') {
    buildingType = Number(felt(query.buildingType));
    if (buildingType === Building.IDS.EMPTY_LOT || !Object.values(Building.IDS).includes(buildingType)) {
      throw new Error('Invalid building type');
    }
  } else if (query.buildingType !== undefined) throw new Error('Building type is only used for ConstructionPlan');
  return { system: query.system, target, crewId, buildingType };
};

module.exports = { observationSystems, observationInput, entityId };
