import { multiaddr } from '@multiformats/multiaddr';
import { PrivateData } from '@influenceth/sdk';
import { readJSON, sendJSON } from './protocol.mjs';
import { verifyReplicationAuthorization } from './replication.mjs';

export const REPLICATION_PROTOCOL = '/influence/private-replication/1.0.0';

export function createReplicator({ node, store, peers, intervalMs = 15000, onError = () => {} }) {
  const addresses = peers.map(value => {
    const address = multiaddr(value), peer = address.toString().split('/p2p/').at(-1);
    if (!value.includes('/p2p/')) throw new Error('Replication addresses must include their peer ID.');
    return { address, peer };
  }).filter(({ peer }) => peer !== node.peerId.toString());
  const acknowledged = new Map();
  let running, stopped = false;
  const flush = () => {
    if (running || stopped) return running;
    running = (async () => {
      for (const [id, head] of store.heads()) {
        if (stopped) break;
        if (!head.replication || head.replication.expiresAt <= Date.now() / 1000) continue;
        const targets = addresses.filter(({ peer }) => head.replication.peers.includes(peer)
          && acknowledged.get(`${id}:${peer}`) !== `${head.revision}:${head.replication.signature}`);
        if (!targets.length) continue;
        const entry = await store.readEntry(id, head.owner);
        await verifyReplicationAuthorization(id, entry.replication, { recipient: node.peerId.toString(), owner: entry.owner });
        for (const { address, peer } of targets) {
          if (stopped) break;
          let stream;
          const signal = AbortSignal.timeout(8000);
          const abort = () => stream?.abort(new Error('Private-data replication timed out.'));
          signal.addEventListener('abort', abort, { once: true });
          try {
            stream = await node.dialProtocol(address, REPLICATION_PROTOCOL, { signal });
            await sendJSON(stream, { id, record: entry.record, replication: entry.replication }, signal);
            const reply = await readJSON(stream);
            if (reply.error) throw new Error(reply.error);
            if (reply.id !== id || reply.revision !== entry.record.revision
                || reply.hash !== await PrivateData.contentHash(entry.record, id)) {
              throw new Error('Replication peer did not acknowledge the retained revision.');
            }
            acknowledged.set(`${id}:${peer}`, `${entry.record.revision}:${entry.replication.signature}`);
          } catch (error) { stream?.abort(error); onError(error, peer); }
          finally { signal.removeEventListener('abort', abort); }
        }
      }
    })().catch(error => onError(error)).finally(() => { running = null; });
    return running;
  };
  const timer = setInterval(flush, intervalMs);
  timer.unref();
  queueMicrotask(flush);
  return { flush, async stop() { stopped = true; clearInterval(timer); await running; } };
}
