import { PrivateData } from '@influenceth/sdk';
import { publicKeyFromRaw } from '@libp2p/crypto/keys';
import { peerIdFromPublicKey, peerIdFromString } from '@libp2p/peer-id';

export const REPLICATION_DOMAIN = 'Influence private-data replication v1';
export const authorizationMessage = (id, grant) => JSON.stringify([
  REPLICATION_DOMAIN, id, grant.ownerPublicKey, grant.peers, grant.expiresAt
]);

export async function verifyReplicationAuthorization(id, grant, { recipient, sender, owner, now = Date.now() / 1000 }) {
  if (!/^[a-f0-9]{64}$/.test(id) || !grant || !/^[a-f0-9]{64}$/.test(grant.ownerPublicKey)
      || !/^[a-f0-9]{128}$/.test(grant.signature) || !Array.isArray(grant.peers)
      || grant.peers.length < 1 || grant.peers.length > 16
      || !Number.isSafeInteger(grant.expiresAt) || grant.expiresAt <= now
      || grant.expiresAt > now + 30 * 86400) throw new Error('Invalid or expired replication authorization.');
  const canonical = [...new Set(grant.peers)].sort();
  if (JSON.stringify(canonical) !== JSON.stringify(grant.peers)
      || canonical.some(peer => typeof peer !== 'string' || peerIdFromString(peer).toString() !== peer)
      || !canonical.includes(recipient) || (sender && !canonical.includes(sender))) {
    throw new Error('Replication peer is not authorized by the record owner.');
  }
  const key = publicKeyFromRaw(Uint8Array.from(Buffer.from(grant.ownerPublicKey, 'hex')));
  const identity = peerIdFromPublicKey(key).toString();
  if (owner && identity !== owner) throw new Error('Replication authorization belongs to another owner.');
  const message = await PrivateData.sha256(authorizationMessage(id, grant));
  if (!await key.verify(new TextEncoder().encode(message), Uint8Array.from(Buffer.from(grant.signature, 'hex')))) {
    throw new Error('Invalid replication authorization signature.');
  }
  return { publicKey: key, owner: identity };
}
