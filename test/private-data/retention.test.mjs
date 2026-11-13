import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Encryption, PrivateData } from '@influenceth/sdk';
import { createRetentionStore } from '../../src/private-data/retentionStore.mjs';
import { createRetentionPeer } from '../../src/private-data/peer.mjs';
import { createPrivateDataNode } from '../../src/private-data/node.mjs';
import { readJSON, sendJSON } from '../../src/private-data/protocol.mjs';

async function signed(scope, revision = 1, updatedAt = 1) {
  const key = await Encryption.generatePrivateKeyFromSeed('retention-integration');
  const ciphertext = await PrivateData.encryptRecord(Encryption.getPublicKeyFromPrivateKey(key), { secret: 'private vein' });
  return { key, ...await PrivateData.signRecord(key, scope, { revision, ciphertext, updatedAt }) };
}
test('durable ciphertext survives restart, isolates authors and rejects stale/divergent writers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'influence-retention-'));
  try {
    const first = await signed('chain/dispatcher/campaign/7');
    let store = await createRetentionStore(directory, { maxRecords: 2, maxRecordsPerPeer: 1 });
    const ack = await store.put(first.id, 'owner', first.record, 0);
    assert.equal(ack.hash, await PrivateData.contentHash(first.record, first.id));
    const disk = await readFile(join(directory, `${first.id}.json`), 'utf8');
    assert(!disk.includes('private vein'));
    assert(!disk.includes('chain/dispatcher/campaign/7'));
    assert(!disk.includes(first.key));
    store = await createRetentionStore(directory, { maxRecords: 2, maxRecordsPerPeer: 1 });
    assert.deepEqual(await PrivateData.decryptRecord(first.key, 'chain/dispatcher/campaign/7',
      await store.get(first.id, 'owner')), { secret: 'private vein' });
    await assert.rejects(store.get(first.id, 'intruder'), /another peer identity/);
    assert.deepEqual(await store.put(first.id, 'owner', first.record, 0), ack);
    const second = await signed('chain/dispatcher/campaign/7', 2, 2);
    await store.put(second.id, 'owner', second.record, 1);
    await assert.rejects(store.put(first.id, 'owner', first.record, 0), /revision conflict/);
    const other = await signed('chain/dispatcher/campaign/8');
    await assert.rejects(store.put(other.id, 'owner', other.record, 0), /retention limit/);
    await store.put(other.id, 'another-owner', other.record, 0);
    const third = await signed('chain/dispatcher/campaign/9');
    await assert.rejects(store.put(third.id, 'third-owner', third.record, 0), /retention limit/);
    assert.equal((await readdir(directory)).filter(file => file.endsWith('.json')).length, 2);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('WebSocket/Noise peer authenticates signed records and acknowledges disk retention', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'influence-retention-network-'));
  let peer, writer, stranger;
  try {
    const data = await signed('chain/dispatcher/campaign/17');
    peer = await createRetentionPeer({ directory, seed: new Uint8Array(32).fill(7), listen: ['/ip4/127.0.0.1/tcp/0/ws'] });
    writer = await createPrivateDataNode({ privateKey: await PrivateData.derivePeerPrivateKey(data.key) });
    stranger = await createPrivateDataNode();
    const request = async (node, message) => {
      const stream = await node.dialProtocol(peer.getMultiaddrs()[0], PrivateData.PROTOCOL,
        { signal: AbortSignal.timeout(5000) });
      await sendJSON(stream, message);
      return readJSON(stream);
    };
    const put = await request(writer, { op: 'put', id: data.id, record: data.record, previousRevision: 0 });
    assert.equal(put.revision, 1);
    assert.equal(put.hash, await PrivateData.contentHash(data.record, data.id));
    assert.deepEqual((await request(writer, { op: 'get', id: data.id })).record, data.record);
    assert.match((await request(stranger, { op: 'get', id: data.id })).error, /another peer identity/);
    assert.match((await request(writer, { op: 'put', id: data.id,
      record: { ...data.record, signature: '00'.repeat(64) }, previousRevision: 1 })).error, /authentication failed/);
  } finally {
    await writer?.stop();
    await stranger?.stop();
    await peer?.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
