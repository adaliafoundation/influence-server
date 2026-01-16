const mongoose = require('mongoose');

class EventService {
  static findById(id) {
    return mongoose.model('Event').findById(id);
  }

  static findOne(query) {
    return mongoose.model('Event').findOne(query);
  }

  static getNonProcessed({ limit = 1000 } = { }) {
    return mongoose.model('Event').find({ lastProcessed: null, removed: { $ne: true } })
      .sort({ timestamp: 1, transactionIndex: 1, logIndex: 1 }).limit(limit);
  }

  static getFromTimestamp({ limit = 1000, timestamp } = {}) {
    return mongoose.model('Event').find({ timestamp: { $gt: timestamp } })
      .sort({ timestamp: 1, transactionIndex: 1, logIndex: 1 }).limit(limit);
  }

  static updateLastProcessed(event) {
    return mongoose.model('Event').updateOne({ _id: event._id }, { lastProcessed: new Date() });
  }

  static deleteOneById(id) {
    return mongoose.model('Event').deleteOne({ _id: id });
  }
}

module.exports = EventService;
