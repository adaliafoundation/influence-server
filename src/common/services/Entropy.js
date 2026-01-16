const mongoose = require('mongoose');

class EntropyService {
  static async updateOrCreate({ event, data }) {
    if (!data.entropy || !data.round) throw new Error('Invalid/missing entropy or round data.');
    if (!event || !event._id || !event.timestamp) throw new Error('Invalid/missing event data.');

    return mongoose.model('Entropy').updateOne({
      round: data.round
    }, {
      entropy: data.entropy,
      event: {
        id: event._id,
        timestamp: event.timestamp
      },
      round: data.round
    }, {
      upsert: true
    });
  }
}

module.exports = EntropyService;
