const mongoose = require('mongoose');
const appConfig = require('config');
const moment = require('moment');
const { castArray } = require('lodash');
const Entity = require('@common/lib/Entity');
const logger = require('@common/lib/logger');
const SendGrid = require('@common/lib/SendGrid');
const NotificationConfig = require('./config');

class NotificationsProcessor {
  _notificationClient = null;

  _sendFrom;

  _toPurge = [];

  _toSend = {};

  constructor({ emailClient = null } = {}) {
    this._emailClient = emailClient || new SendGrid();
    this._sendFrom = {
      email: appConfig.get('Notifications.email.from.email'),
      name: appConfig.get('Notifications.email.from.name')
    };
    this._notificationTemplateId = appConfig.get('SendGrid.templates.notification');
  }

  async process() {
    const docs = await this._getNotificationsToProcess();

    if (docs.length === 0) {
      logger.info('No notifications to process');
      return;
    }

    logger.info(`Processing ${docs.length} notifications`);

    // group and filter notifications
    // @TODO: Filter out any notifications that are over a certain age
    await this.groupAndFilter(docs);

    // send notifications
    await this._sendNotifications();

    // purge processed notifications
    await this._purgeNotifications();
  }

  /** Private Methods */
  _formatSubject(formattedNotifications) {
    const { title } = formattedNotifications[0];
    const subject = `${title || 'Influence Notification'}`;
    return (formattedNotifications.length > 1) ? `${subject} (+${formattedNotifications.length - 1} more)` : subject;
  }

  /**
   * Formats the notifications for a single recipient
   *
   * @param {NotificationDocuments} notifications
   * @returns Object
   */
  async _formatMessage({ notifications }) {
    if (notifications.length === 0) throw new Error('No notifications to format');

    const imageServerUri = appConfig.get('App.imagesServerUrl');
    const formatted = [];

    // loop over notifications and use the correct formatter to format the notification
    for (const notification of notifications) {
      const { formatter: Formatter } = NotificationConfig.getByDocument(notification);
      if (!Formatter) {
        logger.error(`No formatter found for notification: ${JSON.stringify(notification)}`);
        continue; // eslint-disable-line no-continue
      }

      try {
        const result = await (new Formatter({ notification })).format();
        formatted.push(result);
      } catch (error) {
        logger.error(`Error formatting notification: ${error.message}, doc: ${JSON.stringify(notification)}`);
      }
    }

    if (formatted.length === 0) return null;

    const settingsUrl = `${appConfig.get('App.clientUrl')}/launcher/settings`;
    const subject = this._formatSubject(formatted);

    return { imageServerUri, notifications: formatted, settingsUrl, subject };
  }

  /**
   * Groups and filters notifications by address
   * If the user has no email or has no notifications enabled, the notifications are discarded
   *
   * @param {Array<NotificationDocuments>} docs
   */
  async groupAndFilter(docs) {
    for (const doc of docs) {
      // if a `sendable` method is defined, check if the notification is sendable
      if (doc.sendable && !await doc.sendable()) {
        logger.verbose(`Notification not sendable: ${doc.id}`);
        this._queueForRemoval(doc);
        continue; // eslint-disable-line no-continue
      }

      const addresses = await this._getAddressesForNotification(doc);
      for (const address of addresses) {
        // filtering by address and non-null email. If not found, discard notifications for this address
        const user = await mongoose.model('User').findOne({ address, email: { $ne: null } });

        if (!user || !user.hasAnyNoficationSubscriptionEnabled()) {
          this._queueForRemoval(doc);
          continue; // eslint-disable-line no-continue
        }

        try {
          const { type } = NotificationConfig.getByDocument(doc);
          if (user.notificationSubscriptionEnabled(type)) {
            // Init for address
            if (!this._toSend[address]) this._toSend[address] = { notifications: [], email: user.email };

            this._toSend[address].notifications.push(doc);
          }
        } catch (error) {
          logger.error(`Error filtering notification: ${error.message}, doc: ${doc.id}`);
        }
      }
    }
  }

  /**
   * Fetches notifications that are ready to be processed
   * No later than now but not older than 30 days
   *
   * @returns {Promise<Array<NotificationDocument>>}
   */
  _getNotificationsToProcess() {
    return mongoose.model('Notification').find({
      $and: [
        { notifyOn: { $lte: moment().toISOString() } },
        { notifyOn: { $gte: moment().subtract(30, 'days').toISOString() } }
      ]
    });
  }

  /**
   * Fetches the account addresse(s) for a given notification
   *
   * @param {Object<NotificationDocument>} notification
   * @returns Array<String>
   */
  _getAddressesForNotification(notification) {
    if (notification.recipients.addresses?.length > 0) return notification.recipients.addresses;
    if (notification.recipients.entities?.length > 0) {
      return Promise.all(notification.recipients.map(async (entity) => {
        const crewEntity = (entity.uuid) ? entity : Entity.toEntity(entity);
        const doc = await mongoose.model('CrewComponent').findOneByEntity(crewEntity);
        return doc.delegatedTo;
      }));
    }

    throw new Error('No recipients found for notification');
  }

  _purgeNotifications() {
    logger.debug(`Purging ${this._toPurge.length} notifications`);
    if (this._toPurge.length === 0) return Promise.resolve();
    return mongoose.model('Notification').deleteMany({ _id: { $in: this._toPurge } });
  }

  async _sendNotifications() {
    // for each item in filteredNotifications, format and send email
    for (const { email, notifications } of Object.values(this._toSend)) {
      if (notifications.length === 0) {
        logger.info(`No notifications to send to ${email}`);
        continue; // eslint-disable-line no-continue
      }

      const templateData = await this._formatMessage({ notifications });
      if (!templateData) {
        logger.info(`No notifications to send to ${email}`);
        continue; // eslint-disable-line no-continue
      }
      await this._emailClient.send({
        to: email,
        from: this._sendFrom,
        templateData,
        templateId: this._notificationTemplateId
      });

      this._queueForRemoval(notifications);
    }
  }

  _queueForRemoval(docs) {
    this._toPurge.push(...castArray(docs).map(({ id }) => id));
  }
}

module.exports = NotificationsProcessor;
