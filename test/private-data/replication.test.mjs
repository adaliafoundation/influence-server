import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Encryption, PrivateData } from '@influenceth/sdk';
import { generateKeyPairFromSeed } from '@libp2p/crypto/keys';
import { peerIdFromPublicKey } from '@libp2p/peer-id';
import { createRetentionPeer } from '../../src/private-data/peer.mjs';
import { createPrivateDataNode } from '../../src/private-data/node.mjs';
import { authorizationMessage } from '../../src/private-data/replication.mjs';
import { REPLICATION_PROTOCOL } from '../../src/private-data/replicator.mjs';
import { readJSON, sendJSON } from '../../src/private-data/protocol.mjs';

const seed = n => new Uint8Array(32).fill(n);
const peerId = async n => peerIdFromPublicKey((await generateKeyPairFromSeed('Ed25519', seed(n))).publicKey).toString();
const hex = bytes => Buffer.from(bytes).toString('hex');
async function request(node, address, message, protocol = PrivateData.PROTOCOL) {
  const stream = await node.dialProtocol(address, protocol, { signal: AbortSignal.timeout(3000) });
  await sendJSON(stream, message);
  return readJSON(stream);
}
async function signed(key, revision = 1) {
  const ciphertext = await PrivateData.encryptRecord(Encryption.getPublicKeyFromPrivateKey(key), { vein: revision });
  return PrivateData.signRecord(key, 'private-campaign-42', { revision, ciphertext, updatedAt: revision });
}
async function authorize(key, id, peers, expiresAt = Math.floor(Date.now() / 1000) + 3600) {
  const signer = await PrivateData.derivePeerPrivateKey(key);
  const grant = { ownerPublicKey: hex(signer.publicKey.raw), peers: [...peers].sort(), expiresAt };
  grant.signature = hex(await signer.sign(new TextEncoder().encode(await PrivateData.sha256(authorizationMessage(id, grant)))));
  return grant;
}
async function eventually(fn) {
  for (let i = 0; i < 100; i++) {
    if (await fn()) return;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error('Replication did not converge');
}

test('a restarted stack forwards its durable backlog and another stack recovers it without the original server', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'influence-replicate-'));
  let first, second, owner;
  try {
    const key = await Encryption.generatePrivateKeyFromSeed('replication-owner');
    owner = await createPrivateDataNode({ privateKey: await PrivateData.derivePeerPrivateKey(key) });
    second = await createRetentionPeer({ directory: join(directory, 'b'), seed: seed(22), listen: ['/ip4/127.0.0.1/tcp/0/ws'] });
    const address = second.getMultiaddrs()[0];
    const listen = address.toString().split('/p2p/')[0];
    await second.stop(); second = null;
    const startFirst = () => createRetentionPeer({ directory: join(directory, 'a'), seed: seed(21),
      listen: ['/ip4/127.0.0.1/tcp/0/ws'], replicationPeers: [address.toString()], replicationIntervalMs: 50 });
    first = await startFirst();
    const initial = await signed(key), replication = await authorize(key, initial.id, [await peerId(21), await peerId(22)]);
    const reply = await request(owner, first.getMultiaddrs()[0], { op: 'put', ...initial, replication, previousRevision: 0 });
    assert.equal(reply.revision, 1);
    await first.stop(); first = null;
    second = await createRetentionPeer({ directory: join(directory, 'b'), seed: seed(22), listen: [listen] });
    first = await startFirst();
    await eventually(async () => (await request(owner, address, { op: 'get', id: initial.id })).record?.revision === 1);
    const next = await signed(key, 3);
    assert.equal((await request(owner, first.getMultiaddrs()[0], {
      op: 'put', ...next, replication, previousRevision: 1
    })).revision, 3);
    await eventually(async () => (await request(owner, address, { op: 'get', id: initial.id })).record?.revision === 3);
    await first.stop(); first = null;
    const restored = (await request(owner, address, { op: 'get', id: initial.id })).record;
    assert.deepEqual(await PrivateData.decryptRecord(key, 'private-campaign-42', restored), { vein: 3 });
    // The replication permission grants forwarding, not access through the normal owner API.
    const relay = await createPrivateDataNode({ seed: seed(21) });
    try { assert.match((await request(relay, address, { op: 'get', id: initial.id })).error, /another peer identity/); }
    finally { await relay.stop(); }
  } finally {
    await first?.stop(); await second?.stop(); await owner?.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test('replication rejects forged permissions, unapproved peers, altered records, stale versions and equal-version forks', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'influence-replication-auth-'));
  let receiver, relay, stranger, owner;
  try {
    const key = await Encryption.generatePrivateKeyFromSeed('replication-validation');
    receiver = await createRetentionPeer({ directory, seed: seed(32), listen: ['/ip4/127.0.0.1/tcp/0/ws'] });
    relay = await createPrivateDataNode({ seed: seed(31) });
    stranger = await createPrivateDataNode({ seed: seed(33) });
    owner = await createPrivateDataNode({ privateKey: await PrivateData.derivePeerPrivateKey(key) });
    const address = receiver.getMultiaddrs()[0], initial = await signed(key);
    const replication = await authorize(key, initial.id, [relay.peerId.toString(), receiver.peerId.toString()]);
    const send = (message, node = relay) => request(node, address, message, REPLICATION_PROTOCOL);
    assert.match((await send({ ...initial, replication }, stranger)).error, /not authorized/);
    assert.match((await send({ ...initial,
      replication: await authorize(key, initial.id, [relay.peerId.toString(), stranger.peerId.toString()]) })).error,
    /not authorized/);
    assert.match((await send({ ...initial, replication: { ...replication, signature: '00'.repeat(64) } })).error, /signature/);
    assert.match((await send({ ...initial, replication: await authorize(key, initial.id, replication.peers, 1) })).error, /expired/);
    assert.match((await send({ ...initial, id: '0'.repeat(64), replication })).error, /signature/);
    assert.match((await send({ ...initial, record: { ...initial.record, revision: 2 }, replication })).error, /authentication/);
    assert.equal((await request(owner, address, { op: 'get', id: initial.id })).record, null);
    assert.equal((await send({ ...initial, replication })).revision, 1);
    const next = await signed(key, 2);
    assert.equal((await send({ ...next, replication })).revision, 2);
    assert.match((await send({ ...initial, replication })).error, /revision conflict/);
    const fork = await signed(key, 2);
    assert.match((await send({ ...fork, replication })).error, /revision conflict/);
    const retained = (await request(owner, address, { op: 'get', id: initial.id })).record;
    assert.deepEqual(retained, next.record);
  } finally {
    await receiver?.stop(); await relay?.stop(); await stranger?.stop(); await owner?.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
