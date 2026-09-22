const { Mission, Entity } = require('@influenceth/sdk');

const FELT_LIMIT = (2n ** 251n) + 17n * (2n ** 192n) + 1n;

// Canonical decimal strings are shared by database keys, event payloads and the API.
const felt = (value) => {
  if ((typeof value === 'number' && !Number.isSafeInteger(value))
    || !['string', 'number', 'bigint'].includes(typeof value)
    || !/^(0x[0-9a-f]+|[0-9]+)$/i.test(String(value))) throw new TypeError('Invalid felt');
  const result = BigInt(value);
  if (result < 0n || result >= FELT_LIMIT) throw new RangeError('Invalid felt');
  return result.toString();
};

const jsonSafe = (value) => JSON.parse(JSON.stringify(value, (key, item) => (
  typeof item === 'bigint' ? item.toString() : item
)));

const subjectFromUuid = (uuid) => {
  const packed = BigInt(felt(uuid));
  const subject = { label: Number(packed & 65535n), id: (packed >> 16n).toString() };
  if (!Object.values(Entity.IDS).includes(subject.label) || BigInt(subject.id) === 0n
    || BigInt(subject.id) >= (2n ** 64n)) throw new RangeError('Invalid subject');
  return subject;
};

const subjectUuid = (subject) => Entity.packEntity(subject);
const subjectRoom = (subject) => {
  const name = Object.keys(Entity.IDS).find((key) => Entity.IDS[key] === subject.label);
  if (!name) throw new Error('Unknown subject label');
  return `${name[0]}${name.slice(1).toLowerCase()}::${subject.id}`;
};

const slotOrder = (slot) => felt(slot).padStart(76, '0');
const pathKey = (path) => path.map(felt).join(':');

const cellData = (path, value) => {
  const normalized = path.map(felt);
  const parsed = Mission.parsePath(normalized);
  return {
    path: normalized,
    pathKey: pathKey(normalized),
    value: felt(value),
    namespace: parsed?.type || 'Unknown',
    ...(parsed?.campaign !== undefined ? { campaign: parsed.campaign.toString() } : {}),
    ...(parsed?.subject ? { subjectUuid: subjectUuid(parsed.subject) } : {}),
    ...(parsed?.page !== undefined ? { page: parsed.page } : {}),
    ...(parsed?.slot !== undefined ? { slot: parsed.slot.toString(), slotOrder: slotOrder(parsed.slot) } : {})
  };
};

module.exports = { felt, jsonSafe, subjectFromUuid, subjectUuid, subjectRoom, slotOrder, pathKey, cellData };
