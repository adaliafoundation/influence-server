const mongoose = require('mongoose');
const { last } = require('lodash');
const { Asteroid } = require('@influenceth/sdk');
const { InfuraIpfs } = require('@common/lib/Ipfs');
const Entity = require('@common/lib/Entity');

class PrepaidMerklePolicyService {
  static _getMaxSizeForAsteroid(asteroid) {
    const asteroidEntity = Entity.toEntity(asteroid);
    const baseSize = 884_682; // 884_682 bytes per 10k lots
    if (!asteroidEntity) throw new Error('Invalid asteroid entity');
    const lotCount = Asteroid.getSurfaceArea(asteroidEntity.id);
    return baseSize * (lotCount / 10_000);
  }

  static async uploadMerkleTree({ entity, permission, merkleTree }) {
    // find existing component document
    const doc = await mongoose.model('PrepaidMerklePolicyComponent').findOne({
      'entity.uuid': Entity.toEntity(entity).uuid,
      permission
    });
    if (!doc) throw new Error('No matching prepaid merkle policy found');

    // Validate tree
    if (merkleTree.length === 0 || BigInt(last(last(merkleTree))) !== BigInt(doc.merkleRoot)) {
      throw new Error('PrepaidMerklePolicyService::uploadMerkleTree: Invalid merkle tree or root');
    }

    // Size validation
    const size = Buffer.byteLength(JSON.stringify(merkleTree), 'utf8');
    const approxSize = this._getMaxSizeForAsteroid(entity);
    const diff = (size <= approxSize) ? size / approxSize : approxSize / size;
    if (diff <= 0.95) { // allow a 5% margin of error
      throw new Error('PrepaidMerklePolicyService::uploadMerkleTree: Invalid merkle tree size');
    }

    // Extract the lot indices from the merkle tree
    // The leaves, should be lot UUIDS (strings) and be in the first element of the merkle tree
    const totalLotCount = Asteroid.getSurfaceArea(entity.id);
    const lotIndices = merkleTree[0]?.reduce((acc, lotUuid) => {
      if (lotUuid === 0) return acc;
      const lotEntity = Entity.fromUuid(lotUuid);
      const { lotIndex } = lotEntity.unpackLot();
      acc.push(lotIndex);
      return acc;
    }, []);

    if (lotIndices.length > totalLotCount) {
      throw new Error('PrepaidMerklePolicyService::uploadMerkleTree: Invalid merkle tree (lot count mismatch');
    }

    // upload and pin tree to IPFS
    const { hash } = await (new InfuraIpfs()).addData(JSON.stringify(merkleTree), { pin: true });
    doc.set({ merkleTreeIpfsHash: hash, lotIndices });
    return doc.save();
  }
}

module.exports = PrepaidMerklePolicyService;
