const mongoose = require('mongoose');
const { isNil } = require('lodash');
const { Address } = require('@influenceth/sdk');
const Entity = require('@common/lib/Entity');
const NftImage = require('@common/lib/NftImage');
const CrewService = require('@common/services/Crew');
const logger = require('@common/lib/logger');

class NftComponentService {
  static findByOwner(owner, label = null) {
    const filter = {
      $or: [
        { 'owners.ethereum': Address.toStandard(owner, 'ethereum') },
        { 'owners.starknet': Address.toStandard(owner, 'starknet') }
      ]
    };
    if (label) Object.assign(filter, { 'entity.label': label });

    return mongoose.model('NftComponent').find(filter);
  }

  static findAsteroidNftsByOwner(owner) {
    return this.findByOwner(owner, Entity.IDS.ASTEROID);
  }

  static findOne(filter, { lean = true } = {}) {
    const action = mongoose.model('NftComponent').findOne(filter);
    if (lean) action.lean();
    return action;
  }

  static async isOwner(address, entity) {
    if (!address) throw new Error('Missing address');
    if (!entity) throw new Error('Missing entity');
    const _entity = Entity.toEntity(entity);
    const filter = {
      'entity.uuid': _entity.uuid,
      $or: [
        { 'owners.ethereum': Address.toStandard(address, 'ethereum') },
        { 'owners.starknet': Address.toStandard(address, 'starknet') }
      ]
    };

    const result = await mongoose.model('NftComponent').exists(filter);
    return !isNil(result);
  }

  static async updateCards({ buildLimit = 1 } = {}) {
    const flushBuffer = async (buffer) => {
      const results = await Promise.allSettled(buffer.map(async (nftCompDoc) => {
        logger.verbose(`updating card for entity: ${nftCompDoc.entity}...`);

        const nftImage = new NftImage(nftCompDoc.entity);
        await nftImage.buildAndUpdate();

        // reset the updateImage flag
        await mongoose.model('NftComponent').updateOne({ _id: nftCompDoc._id }, { updateImage: false });
      }));

      // @TODO: handle errors
      for (const result of results) {
        if (result.status === 'rejected') logger.error(result.reason);
      }
    };

    const cursor = mongoose.model('NftComponent').find({ updateImage: true }).cursor();

    let buffer = [];
    for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
      // flush buffer if we've reached the limit
      if (buffer.length >= buildLimit) {
        await flushBuffer(buffer);

        // reset the buffer
        buffer = [];
      }

      buffer.push(doc);
    }

    if (buffer.length > 0) await flushBuffer(buffer);
  }

  static async flagForCardUpdate(entity, flagRelated = false) {
    const _entity = Entity.toEntity(entity);
    const filter = { 'entity.uuid': _entity.uuid };
    const update = { entity: _entity.toObject(), updateImage: true };

    if (![Entity.IDS.ASTEROID, Entity.IDS.CREW, Entity.IDS.CREWMATE, Entity.IDS.SHIP].includes(_entity.label)) {
      return null;
    }

    await mongoose.model('NftComponent').updateOne(filter, update, { upsert: true });
    return (flagRelated) ? this.flagRelatedForCardUpdate(_entity) : null;
  }

  static async flagRelatedForCardUpdate(entity) {
    const _entity = Entity.toEntity(entity);

    if (_entity.isCrewmate()) {
      const crewComponentDoc = await CrewService.getCrewForCrewmate(_entity);

      return (crewComponentDoc && await CrewService.isCaptain(crewComponentDoc, _entity))
        ? this.flagForCardUpdate(crewComponentDoc.entity) : null;
    }

    return null;
  }

  static updateOne(filter, update) {
    return mongoose.model('NftComponent').updateOne(filter, update, { upsert: true });
  }
}

module.exports = NftComponentService;
