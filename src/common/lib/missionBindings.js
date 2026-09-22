const { Entity } = require('@influenceth/sdk');
const { felt } = require('./missions');

const bindingTypes = {
  Built: { component: 'Building', label: Entity.IDS.BUILDING, helper: 'getBuildingFingerprint' },
  Sample: { component: 'Deposit', label: Entity.IDS.DEPOSIT, helper: 'getSampleFingerprint' },
  Extraction: { component: 'Extractor', label: Entity.IDS.BUILDING, helper: 'getExtractionFingerprint', slotted: true },
  Process: { component: 'Processor', label: Entity.IDS.BUILDING, helper: 'getProcessFingerprint', slotted: true },
  Delivery: { component: 'Delivery', label: Entity.IDS.DELIVERY, helper: 'getDeliveryFingerprint' }
};

// Read retained Cairo Serde values, not rounded component display values.
const decodeComponent = (component, event) => {
  const values = [...event.data];
  const integer = () => {
    const value = felt(values.shift());
    if (BigInt(value) >= 2n ** 64n) throw new Error('Invalid u64 component field');
    return value;
  };
  const boolean = () => {
    const value = integer();
    if (!['0', '1'].includes(value)) throw new Error('Invalid component boolean');
    return value === '1';
  };
  const entity = () => ({ label: integer(), id: integer() });
  const fixed = () => ({ mag: integer(), sign: boolean() });
  const items = () => {
    const count = Number(integer());
    if (count > values.length / 2) throw new Error('Invalid inventory length');
    return Array.from({ length: count }, () => ({ product: integer(), amount: integer() }));
  };
  const pathLength = Number(integer());
  const expectedLength = ['Processor', 'Extractor'].includes(component) ? 2 : 1;
  if (pathLength !== expectedLength) throw new Error('Invalid component path');
  const path = values.splice(0, pathLength).map(felt);
  let data;
  switch (component) {
    case 'Building':
      data = { status: integer(), building_type: integer(), planned_at: integer(), finish_time: integer() };
      break;
    case 'Deposit':
      data = {
        status: integer(),
        resource: integer(),
        initial_yield: integer(),
        remaining_yield: integer(),
        finish_time: integer(),
        yield_eff: fixed()
      };
      break;
    case 'Extractor':
      data = {
        extractor_type: integer(),
        status: integer(),
        output_product: integer(),
        yield: integer(),
        destination: entity(),
        destination_slot: integer(),
        finish_time: integer()
      };
      break;
    case 'Processor':
      data = {
        processor_type: integer(),
        status: integer(),
        running_process: integer(),
        output_product: integer(),
        recipes: fixed(),
        secondary_eff: fixed(),
        destination: entity(),
        destination_slot: integer(),
        finish_time: integer()
      };
      break;
    case 'Delivery':
      data = {
        status: integer(),
        origin: entity(),
        origin_slot: integer(),
        dest: entity(),
        dest_slot: integer(),
        finish_time: integer(),
        contents: items()
      };
      break;
    default:
      throw new Error('Unsupported mission component');
  }
  if (values.length) throw new Error('Unexpected trailing component fields');
  return { path, data };
};

module.exports = { bindingTypes, decodeComponent };
