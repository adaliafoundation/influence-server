const mongoose = require('mongoose');
const { isEmpty } = require('lodash');

class AsteroidSaleService {
  static async updateOrCreateFromEvent({ event, data }) {
    const model = mongoose.model('AsteroidSale');

    // use specified filter or use the unique path for the component
    const doc = model(data);
    if (!doc.uniquePath || isEmpty(doc.uniquePath())) throw new Error('Missing filter or doc.uniquePath()');

    const result = await model.updateOne(
      doc.uniquePath(),
      [{
        $replaceRoot: {
          newRoot: {
            $cond: [
              {
                $or: [
                  { $eq: ['$event.timestamp', null] },
                  { $gte: [event.timestamp, '$event.timestamp'] }
                ]
              },
              {
                ...doc.toJSON(),
                _id: '$_id',
                event: {
                  id: event._id,
                  timestamp: event.timestamp
                }
              },
              '$$ROOT'
            ]
          }
        }
      }],
      { upsert: true }
    );

    return result;
  }

  static async getLatest() {
    return mongoose.model('AsteroidSale').findOne().sort({ period: -1 });
  }
}

module.exports = AsteroidSaleService;
