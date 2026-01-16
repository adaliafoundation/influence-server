const mongoose = require('mongoose');
const moment = require('moment');

class DirectMessageNotificationService {
  static get model() {
    return mongoose.model('DirectMessageNotification');
  }

  static async createOrUpdate(directMesssageDoc) {
    if (!(directMesssageDoc instanceof mongoose.model('DirectMessage'))) {
      throw new Error('DirectMessageNotificationService::createOrUpdate: Invalid document provided.');
    }

    const filter = { directMessage: directMesssageDoc._id };

    const { modifiedCount, upsertedCount } = await this.model.updateOne(
      filter,
      {
        notifyOn: moment(),
        recipients: { addresses: [directMesssageDoc.recipient] }
      },
      { upsert: true, new: true }
    );

    return {
      created: (upsertedCount > 0),
      updated: (modifiedCount > 0),
      doc: await this.model.findOne(filter)
    };
  }
}

module.exports = DirectMessageNotificationService;
