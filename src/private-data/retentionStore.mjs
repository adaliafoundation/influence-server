import { mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrivateData } from '@influenceth/sdk';
const { contentHash, validateRemoteRecord } = PrivateData;
const conflict = message => Object.assign(new Error(message), { code: 'PRIVATE_DATA_REVISION_CONFLICT' });

export async function createRetentionStore(directory, { maxRecords = 10000, maxRecordsPerPeer = 500 } = {}) {
  if (![maxRecords, maxRecordsPerPeer].every(value => Number.isSafeInteger(value) && value > 0)) {
    throw new Error('Private-data record limits must be positive integers.');
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const parent = await open(dirname(directory), 'r');
  try { await parent.sync(); } finally { await parent.close(); }
  const pending = new Map();
  const owners = new Map(), counts = new Map(), heads = new Map();
  for (const file of await readdir(directory)) {
    if (!/^[a-f0-9]{64}\.json$/.test(file)) continue;
    const stored = JSON.parse(await readFile(join(directory, file), 'utf8'));
    owners.set(file.slice(0, 64), stored.owner);
    heads.set(file.slice(0, 64), { owner: stored.owner, revision: stored.record.revision, replication: stored.replication });
    counts.set(stored.owner, (counts.get(stored.owner) || 0) + 1);
  }
  const filename = (id) => {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid private record identifier.');
    return join(directory, `${id}.json`);
  };
  async function readEntry(id, owner) {
    let value;
    try { value = JSON.parse(await readFile(filename(id), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    if (value.owner !== owner) throw new Error('Private record belongs to another peer identity.');
    return value;
  }
  async function read(id, owner) { return (await readEntry(id, owner))?.record || null; }
  async function write(id, owner, record, previousRevision, replication, replicated = false) {
    validateRemoteRecord(record);
    const entry = await readEntry(id, owner), old = entry?.record;
    const authority = replication || entry?.replication;
    const hash = await contentHash(record, id);
    if (old && (old.revision > record.revision || (old.revision === record.revision && await contentHash(old, id) !== hash))) {
      throw conflict('Private record revision conflict. Recover the newest saved campaign before writing.');
    }
    if (!replicated && old && old.revision !== record.revision && old.revision !== previousRevision) {
      throw conflict('Private record revision conflict. This device has not recovered the current remote revision.');
    }
    if (!old || old.revision !== record.revision || JSON.stringify(authority) !== JSON.stringify(entry.replication)) {
      let allocated = false, renamed = false;
      if (!owners.has(id)) {
        if (owners.size >= maxRecords || (counts.get(owner) || 0) >= maxRecordsPerPeer) {
          throw new Error('Private-data retention limit reached.');
        }
        owners.set(id, owner);
        counts.set(owner, (counts.get(owner) || 0) + 1);
        allocated = true;
      }
      const file = filename(id), temporary = `${file}.${randomUUID()}.tmp`;
      try {
        const handle = await open(temporary, 'wx', 0o600);
        try { await handle.writeFile(JSON.stringify({ owner, record, replication: authority })); await handle.sync(); }
        finally { await handle.close(); }
        await rename(temporary, file);
        renamed = true;
      } catch (error) {
        if (allocated && !renamed) {
          owners.delete(id);
          counts.set(owner, counts.get(owner) - 1);
        }
        throw error;
      } finally { await rm(temporary, { force: true }); }
    }
    const directoryHandle = await open(directory, 'r');
    try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
    heads.set(id, { owner, revision: record.revision, replication: authority });
    return { id, revision: record.revision, hash };
  }
  function put(id, owner, record, previousRevision, replication, replicated = false) {
    // Serialize writes to each head so simultaneous streams cannot overwrite a newer revision.
    const task = (pending.get(id) || Promise.resolve()).catch(() => {})
      .then(() => write(id, owner, record, previousRevision, replication, replicated));
    pending.set(id, task);
    task.finally(() => { if (pending.get(id) === task) pending.delete(id); }).catch(() => {});
    return task;
  }
  return {
    get: read, readEntry, heads: () => heads.entries(), put,
    // Relays transfer already owner-signed snapshots. They may advance a head,
    // but can never forge its revision or overwrite a divergent equal revision.
    putReplica: (id, owner, record, replication) => put(id, owner, record, undefined, replication, true)
  };
}
