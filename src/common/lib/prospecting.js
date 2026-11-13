const { CallData } = require('starknet');
const { Address, Claim, Entity, Prospecting } = require('@influenceth/sdk');
const { camelCase } = require('lodash');

const COMPONENTS = {
  Claim: { type: 'claim::Claim', path: 1, words: 4 },
  ExtractorSlots: { type: 'extractor_slots::ExtractorSlots', path: 1, words: 1 },
  ProspectingOrigin: { type: 'prospecting_origin::ProspectingOrigin', path: 1, words: 1 },
  ProspectingCampaign: { type: 'prospecting_campaign::ProspectingCampaign', path: 1, words: 16 },
  ProspectingCore: { type: 'prospecting_core::ProspectingCore', path: 2, words: 7 }
};
const decimal = (value) => BigInt(value).toString();
const number = (value) => {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error('Unsafe prospecting integer');
  return result;
};
const entity = (raw) => (raw.id === 0n ? null : { label: number(raw.label), id: number(raw.id) });
const decoders = new Map();
const decodeComponent = (name, event) => {
  const definition = COMPONENTS[name];
  const values = event.data;
  if (!definition || Number(values[0]) !== definition.path
    || values.length !== definition.path + definition.words + 1) {
    throw new Error(`Invalid ${name} component payload`);
  }
  if (!decoders.has(name)) {
    const types = Prospecting.Game.abis.TypeComponent.filter((entry) => ['struct', 'enum'].includes(entry.type));
    decoders.set(name, new CallData([...types, {
      type: 'function',
      name: 'decode',
      inputs: [],
      outputs: [{ type: `influence::components::${definition.type}` }],
      state_mutability: 'view'
    }]));
  }
  const raw = decoders.get(name).parse('decode', values.slice(1 + definition.path));
  const path = values.slice(1, 1 + definition.path).map(decimal);
  const subject = () => {
    const unpacked = Entity.unpackEntity(path[0]);
    if (!Number.isSafeInteger(unpacked.id)) throw new Error('Unsafe component entity ID');
    return { label: unpacked.label, id: unpacked.id };
  };
  if (name === 'Claim') return { entity: subject(), ...Claim.fromContractMetadata(raw) };
  if (name === 'ExtractorSlots') return { entity: subject(), count: number(raw.count) };
  if (name === 'ProspectingOrigin') return { entity: subject(), campaignId: decimal(raw.campaign_id) };
  if (name === 'ProspectingCore') {
    return {
      campaignId: path[0],
      index: number(path[1]),
      commitment: decimal(raw.commitment),
      meta: decimal(raw.meta),
      blockedApproaches: number(raw.blocked_approaches),
      randomness: decimal(raw.randomness),
      targetBlock: number(raw.target_block),
      readyAt: number(raw.ready_at)
    };
  }
  return {
    campaignId: path[0],
    crew: entity(raw.crew),
    creator: Address.toStandard(`0x${raw.creator.toString(16)}`, 'starknet'),
    origin: entity(raw.origin),
    resource: number(raw.resource),
    context: decimal(raw.context),
    qualityBps: number(raw.quality_bps),
    verifier: Address.toStandard(`0x${raw.verifier.toString(16)}`, 'starknet'),
    count: number(raw.count),
    pending: raw.pending,
    status: number(raw.status),
    replaceableAt: number(raw.replaceable_at),
    claim: entity(raw.claim)
  };
};
const normalizeEventValue = (value) => {
  if (typeof value === 'bigint') return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString();
  if (Array.isArray(value)) return value.map(normalizeEventValue);
  if (value && typeof value === 'object') {
    if ('label' in value && 'id' in value) return entity(value);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [camelCase(key), normalizeEventValue(item)]));
  }
  return value;
};
const eventDecoders = new Map();
const gameplayAbi = Object.values(Prospecting.Game.abis).flat();
const decodeEvent = (name, event) => {
  const abi = gameplayAbi;
  const shape = abi.find((entry) => entry.type === 'event' && entry.kind === 'struct'
    && entry.name.endsWith(`::${name}`));
  if (!shape) throw new Error(`Missing gameplay event ABI: ${name}`);
  if (!eventDecoders.has(name)) {
    const types = new Map(abi.filter((entry) => ['struct', 'enum'].includes(entry.type))
      .map((entry) => [entry.name, entry]));
    eventDecoders.set(name, new CallData([...types.values(),
      { type: 'struct',
        name: 'GameplayEvent',
        members: shape.members.map((member) => ({ name: member.name, type: member.type })) },
      { type: 'function',
        name: 'decode',
        inputs: [],
        outputs: [{ type: 'GameplayEvent' }],
        state_mutability: 'view' }]));
  }
  const raw = eventDecoders.get(name).parse('decode', event.data);
  const data = normalizeEventValue(raw);
  for (const key of ['campaignId', 'replacedCampaignId']) if (key in data) data[key] = String(data[key]);
  if (raw.caller !== undefined) data.caller = Address.toStandard(`0x${raw.caller.toString(16)}`, 'starknet');
  return data;
};

module.exports = { COMPONENTS, decodeComponent, decodeEvent };
