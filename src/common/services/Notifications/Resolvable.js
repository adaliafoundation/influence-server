const mongoose = require('mongoose');
const { isNumber } = require('lodash');
const moment = require('moment');
const { getCrewToNotify } = require('@common/lib/notifications/utils');

class ResolvableEventNotificationService {
  // seconds to add to the readyAt to determine when to notify
  static NOTIFY_BUFFER = 3_600; // 1 hour

  static async createOrUpdate({ activity, event, type }) {
    if (!(event instanceof mongoose.model('Event'))) throw new Error('event must be an instance of Event');
    if (!(activity instanceof mongoose.model('Activity'))) throw new Error('activity is required');
    if (!isNumber(event.returnValues?.finishTime)) throw new Error('finishTime must be a number');
    const model = mongoose.model(`${type}Notification`);

    const finishTime = moment.unix(event.returnValues.finishTime);
    const notifyOn = moment.unix(event.returnValues.finishTime).add(this.NOTIFY_BUFFER, 'seconds');

    if (finishTime.isBefore(moment())) return { created: false, updated: false };

    const recipients = await getCrewToNotify(activity.unresolvedFor, 'TASK');
    if (!recipients || recipients.length === 0) return { created: false, updated: false };

    const filter = { 'event.transactionHash': event.transactionHash, 'event.logIndex': event.logIndex };
    const { modifiedCount, upsertedCount } = await model.updateOne(
      filter,
      {
        activity: activity.id || activity._id || activity,
        event: {
          event: event.event,
          logIndex: event.logIndex,
          name: event.name,
          returnValues: event.returnValues,
          transactionHash: event.transactionHash,
          transactionIndex: event.transactionIndex
        },
        notifyOn,
        recipients: {
          entitities: recipients
        }
      },
      { upsert: true, new: true }
    );

    return {
      created: (upsertedCount > 0),
      updated: (modifiedCount > 0),
      doc: await model.findOne(filter)
    };
  }
}

module.exports = ResolvableEventNotificationService;
