const mongoose = require('mongoose');
const { isNumber } = require('lodash');
const moment = require('moment');
const { Permission } = require('@influenceth/sdk');
const Entity = require('@common/lib/Entity');
const { getCrewToNotify } = require('@common/lib/notifications/utils');

class LeaseExpirationNotificationService {
  static NOTIFY_BUFFER = -259_200; // -3 days

  static get model() {
    return mongoose.model('LeaseExpirationNotification');
  }

  static async createOrUpdate({ entity: _entity, endTime, permission, permitted: _permitted }) {
    if (!isNumber(endTime)) throw new Error('endTime must be a number');
    if (!permission) throw new Error('permission is required');

    // If permissions is not USE_LOT, return.
    if (permission !== Permission.IDS.USE_LOT) return { created: false, doc: null, updated: false };

    const entity = Entity.toEntity(_entity);
    const permitted = Entity.toEntity(_permitted);
    const _endTime = moment.unix(endTime);
    const notifyOn = moment.unix(endTime).add(this.NOTIFY_BUFFER, 'seconds');

    // If endTime is in the past, return.
    if (_endTime.isBefore(moment())) return { created: false, updated: false };

    const recipients = await getCrewToNotify(permitted, 'LEASE');
    if (!recipients || recipients.length === 0) return { created: false, updated: false };

    // check for existing notification
    const filter = {
      'entity.uuid': entity.uuid,
      permission,
      'permitted.uuid': permitted.uuid
    };
    const notification = await this.model.findOne(filter);

    // if the specified endTime is the same as the current endTime, return.
    if (notification?.endTime === endTime) return { created: false, updated: false, notification };

    // If not found or endTime is after current, create a new notification
    if (!notification || (notification?.endTime < endTime)) {
      const { modifiedCount, upsertedCount } = await this.model.updateOne(
        filter,
        {
          entity,
          endTime,
          notifyOn,
          permission,
          permitted,
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

module.exports = LeaseExpirationNotificationService;
