const mongoose = require('mongoose');
const { isNumber } = require('lodash');
const moment = require('moment');
const Entity = require('@common/lib/Entity');
const { getCrewToNotify } = require('@common/lib/notifications/utils');

class CrewReadyNotificationService {
  // seconds to add to the readyAt to determine when to notify
  static NOTIFY_BUFFER = 3_600; // 1 hour

  static get model() {
    return mongoose.model('CrewReadyNotification');
  }

  static async createOrUpdate({ crew: _crew, readyAt }) {
    if (!isNumber(readyAt)) throw new Error('readyAt must be a number');

    const crew = Entity.toEntity(_crew);
    const _readyAt = moment.unix(readyAt);
    const notifyOn = moment.unix(readyAt).add(this.NOTIFY_BUFFER, 'seconds');

    // If readyAt is in the past, return.
    if (_readyAt.isBefore(moment())) return { created: false, updated: false };

    const recipients = await getCrewToNotify(crew, 'CREW');
    if (!recipients || recipients.length === 0) return { created: false, updated: false };

    // check for existing notification
    const filter = { 'crew.uuid': crew.uuid };
    const notification = await this.model.findOne(filter);

    // if the specified readyAt is the same as the current readyAt, return.
    if (notification?.readyAt === readyAt) return { created: false, updated: false, notification };

    // If not found or readyAt is after current, create a new notification
    if (!notification || (notification?.readyAt < readyAt)) {
      const { modifiedCount, upsertedCount } = await this.model.updateOne(
        filter,
        {
          crew,
          notifyOn,
          readyAt,
          recipients: {
            entitities: recipients
          }
        },
        { upsert: true, new: true }
      );

      return {
        created: (upsertedCount > 0),
        updated: (modifiedCount > 0),
        doc: await this.model.findOne(filter)
      };
    }

    return { created: false, updated: false, doc: notification };
  }
}

module.exports = CrewReadyNotificationService;
