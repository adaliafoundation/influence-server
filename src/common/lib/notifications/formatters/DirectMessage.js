const appConfig = require('config');
const mongoose = require('mongoose');
const NotificationFormatter = require('./Formatter');

class DirectMessageNotificationFormatter extends NotificationFormatter {
  async format() {
    if (!this._notification.populated('directMessage')) await this._notification.populate('directMessage');

    if (!this._notification.directMessage?._id) {
      throw new Error('DirectMessageNotificationFormatter::format: DirectMessage doc not found.');
    }
    const { recipient, sender } = this._notification.directMessage;

    // get one crew component doc for the delegatedTo user
    const crewComponentDoc = await mongoose.model('CrewComponent')
      .findOne({ delegatedTo: recipient })
      .sort({ 'entity.id': 1 });

    if (!crewComponentDoc) throw new Error(`Crew component doc not found for delegatedTo: ${recipient}`);

    return {
      crewId: crewComponentDoc.entity.id,
      body: `You have received an encrypted communication from ${sender.substr(0, 6)}...${sender.substr(-4)}`,
      title: 'Message Received',
      url: `${appConfig.get('App.clientUrl')}/launcher/inbox`
    };
  }
}

module.exports = DirectMessageNotificationFormatter;
