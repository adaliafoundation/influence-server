const mongoose = require('mongoose');
const { isEmpty } = require('lodash');

class ConstantService {
  static async updateOrCreateFromEvent({ event, data }) {
    const model = mongoose.model('Constant');

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

  static getConstant(name) {
    return mongoose.model('Constant').findOne({ name });
  }

  static getConstants(names) {
    return mongoose.model('Constant').find({ name: { $in: names } });
  }
}

module.exports = ConstantService;
