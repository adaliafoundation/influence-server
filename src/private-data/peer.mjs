import { PrivateData } from '@influenceth/sdk';
import { createPrivateDataNode } from './node.mjs';
import { readJSON, sendJSON } from './protocol.mjs';
import { createRetentionStore } from './retentionStore.mjs';
import { verifyReplicationAuthorization } from './replication.mjs';
import { createReplicator, REPLICATION_PROTOCOL } from './replicator.mjs';

export async function createRetentionPeer({ directory, seed, listen, announce = [], limits,
  replicationPeers = [], replicationIntervalMs, onReplicationError }) {
  const store = await createRetentionStore(directory, limits);
  const node = await createPrivateDataNode({ seed, listen, announce });
  let replicator;
  const handler = (replicated) => async (stream, connection) => {
    const signal = AbortSignal.timeout(10000);
    const abort = () => stream.abort(new Error('Private-data stream timed out.'));
    signal.addEventListener('abort', abort, { once: true });
    try {
      const request = await readJSON(stream);
      let owner = connection.remotePeer.toString();
      let reply;
      if (replicated || request.op === 'put') {
        let publicKey = connection.remotePeer.publicKey;
        if (replicated || request.replication) {
          const verified = await verifyReplicationAuthorization(request.id, request.replication, {
            recipient: node.peerId.toString(), ...(replicated ? { sender: owner } : { owner })
          });
          owner = verified.owner; publicKey = verified.publicKey;
        }
        await PrivateData.verifySignedRecord(publicKey, request.id, request.record);
        reply = await (replicated ? store.putReplica(request.id, owner, request.record, request.replication)
          : store.put(request.id, owner, request.record, request.previousRevision, request.replication));
        replicator?.flush();
      } else if (request.op === 'get') reply = { id: request.id, record: await store.get(request.id, owner) };
      else throw new Error('Unsupported private-data operation.');
      await sendJSON(stream, reply, signal);
    } catch (error) {
      try { await sendJSON(stream, { error: error.message, errorCode: error.code }, signal); }
      catch { stream.abort(error); }
    } finally { signal.removeEventListener('abort', abort); }
  };
  await node.handle(PrivateData.PROTOCOL, handler(false), { maxInboundStreams: 8 });
  await node.handle(REPLICATION_PROTOCOL, handler(true), { maxInboundStreams: 8 });
  replicator = createReplicator({ node, store, peers: replicationPeers, intervalMs: replicationIntervalMs,
    onError: onReplicationError });
  const stop = node.stop.bind(node);
  node.stop = async () => { await replicator.stop(); await stop(); };
  return node;
}
