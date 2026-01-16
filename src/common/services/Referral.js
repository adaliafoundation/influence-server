const mongoose = require('mongoose');
const { isNil } = require('lodash');
const { Address } = require('@influenceth/sdk');
const Entity = require('@common/lib/Entity');
const { ValidationError } = require('../lib/errors');

class ReferralService {
  static async createReferralForBuyer(buyer, entity) {
    if (!entity) throw new ValidationError('Entity is required');
    const _entity = new Entity(entity);

    // Get the user document for the buyer
    const userDoc = await mongoose.model('User').findOne({ address: Address.toStandard(buyer) });
    if (!userDoc) throw new Error(`User document not found for buyer: ${Address.toStandard(buyer)}`);

    // referredBy required to create a referral
    if (!userDoc.referredBy) return null;

    // Create referral update with upsert
    const filter = { buyer: Address.toStandard(buyer), referrer: userDoc.referredBy, 'entity.uuid': _entity.uuid };
    await mongoose.model('Referral').updateOne(
      filter,
      { buyer: Address.toStandard(buyer), referrer: userDoc.referredBy, entity: _entity },
      { upsert: true }
    );

    return mongoose.model('Referral').findOne(filter);
  }

  static async getCountByReferrer(address) {
    if (isNil(address)) throw new ValidationError('Address is required');

    return mongoose.model('Referral').countDocuments({ referrer: Address.toStandard(address) });
  }

  static async find(address) {
    if (isNil(address)) throw new ValidationError('Address is required');

    return mongoose.model('Referral').find({ referrer: Address.toStandard(address) }).lean();
  }
}

module.exports = ReferralService;
