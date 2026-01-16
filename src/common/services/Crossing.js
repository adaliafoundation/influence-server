const mongoose = require('mongoose');
const { castArray } = require('lodash');
const { Address } = require('@influenceth/sdk');
const { BRIDGING_STATES, CHAINS } = require('@common/constants');

class CrossingService {
  static find({ assetIds, assetTypes, destination, fromAddress, origin, status, toAddress } = {}) {
    const filter = { status: { $in: Object.values(BRIDGING_STATES) } };

    if (assetIds) {
      if (Array.isArray(assetIds)) {
        filter.assetIds = { $in: assetIds.map((id) => Number(id)) };
      } else {
        filter.assetIds = { $in: String(assetIds).split(',').map((id) => Number(id)) };
      }
    }
    if (assetTypes) {
      if (Array.isArray(assetTypes)) {
        filter.assetType = { $in: assetTypes.map((s) => s.trim().toUpperCase()) };
      } else {
        filter.assetType = { $in: String(status).split(',').map((s) => s.trim().toUpperCase()) };
      }
    }
    if (destination) filter.destination = destination.toUpperCase();
    if (fromAddress) filter.fromAddress = Address.toStandard(fromAddress);
    if (origin) filter.origin = origin.toUpperCase();
    if (status) filter.status = { $ink: String(status).split(',').map((s) => s.trim().toUpperCase()) };
    if (toAddress) filter.toAddress = Address.toStandard(toAddress);

    return mongoose.model('Crossing').find(filter).lean();
  }

  static removeOne({ assetType, assetIds, destination, origin }) {
    if (!['Asteroid', 'Crew', 'Crewmate', 'Ship']
      .includes(assetType)) throw new Error(`Unsupported asset type: ${assetType}`);
    if (!Array.isArray(assetIds) || assetIds.length === 0) throw new Error(`Invalid assetIds: ${assetIds}`);
    if (!Object.values(CHAINS).includes(destination) || !Object.values(CHAINS).includes(origin)) {
      throw new Error(`Invalid destination or origin: ${destination}, ${origin}`);
    }

    return mongoose.model('Crossing').deleteOne({ assetType, assetIds: { $in: assetIds }, destination, origin });
  }

  static removeAsteroidCrossing(assetIds, origin, destination) {
    return this.removeOne({ assetType: 'Asteroid', assetIds: castArray(assetIds).map(Number), destination, origin });
  }

  static removeCrewCrossing(assetIds, origin, destination) {
    return this.removeOne({ assetType: 'Crew', assetIds: castArray(assetIds).map(Number), destination, origin });
  }

  static removeCrewmateCrossing(assetIds, origin, destination) {
    return this.removeOne({ assetType: 'Crewmate', assetIds: castArray(assetIds).map(Number), destination, origin });
  }

  static removeShipCrossing(assetIds, origin, destination) {
    return this.removeOne({ assetType: 'Ship', assetIds: castArray(assetIds).map(Number), destination, origin });
  }

  static async updateOrCreateFromEvent({ event, data }) {
    const model = mongoose.model('Crossing');

    // use specified filter or use the unique path for the component
    const doc = model(data);

    const filter = { assetIdsKey: doc.assetIdsKey };
    const update = {
      ...doc.toObject(),
      _id: '$_id',
      event: { id: event._id, timestamp: event.timestamp }
    };

    const action = {
      $replaceRoot: {
        newRoot: {
          $cond: [
            {
              $or: [
                { $eq: ['$event.timestamp', null] },
                { $gte: [event.timestamp, '$event.timestamp'] }
              ]
            },
            { $mergeObjects: ['$$ROOT', update] }, // true condition
            '$$ROOT' // false condition
          ]
        }
      }
    };

    const result = await model.updateOne(
      filter,
      [action],
      { upsert: true, setDefaultsOnInsert: false }
    );

    return result;
  }

  static async updateOne(filter, update) {
    return mongoose.model('Crossing').updateOne(filter, update, { upsert: false });
  }
}

module.exports = CrossingService;
