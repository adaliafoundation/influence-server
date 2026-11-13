import { mkdir, open, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createRetentionPeer } from '../private-data/peer.mjs';

const directory = resolve(process.env.PRIVATE_DATA_DIRECTORY || 'data/private-records');
await mkdir(directory, { recursive: true, mode: 0o700 });
let seed;
try { seed = await readFile(join(directory, 'peer.seed')); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  seed = randomBytes(32);
  const handle = await open(join(directory, 'peer.seed'), 'wx', 0o600);
  try { await handle.writeFile(seed); await handle.sync(); } finally { await handle.close(); }
  const parent = await open(directory, 'r');
  try { await parent.sync(); } finally { await parent.close(); }
}
const list = value => value ? value.split(',').map(item => item.trim()).filter(Boolean) : [];
const node = await createRetentionPeer({
  directory: join(directory, 'records'), seed,
  listen: list(process.env.PRIVATE_DATA_LISTEN || '/ip4/127.0.0.1/tcp/15179/ws'),
  announce: list(process.env.PRIVATE_DATA_ANNOUNCE),
  replicationPeers: list(process.env.PRIVATE_DATA_REPLICATION_PEERS),
  onReplicationError: (error, peer) => console.warn(`Private-data replication${peer ? ` to ${peer}` : ''}: ${error.message}`),
  limits: { maxRecords: Number(process.env.PRIVATE_DATA_MAX_RECORDS || 10000),
    maxRecordsPerPeer: Number(process.env.PRIVATE_DATA_MAX_RECORDS_PER_PEER || 500) }
});
console.log(`Encrypted retention peer ready: ${node.getMultiaddrs().join(',')}`);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await node.stop(); process.exit(0); });
