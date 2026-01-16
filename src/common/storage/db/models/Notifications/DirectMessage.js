const { Schema } = require('mongoose');
const NotificationModel = require('../Notification');

const sendable = async function () {
  if (!this.populated('directMessage')) await this.populate('directMessage');
  return this.directMessage?.read !== true;
};

const schema = new Schema({
  directMessage: { type: Schema.Types.ObjectId, ref: 'DirectMessage' }
});

schema
  .index({ directMessage: 1 }, { unique: true })
  .method('sendable', sendable);

module.exports = NotificationModel.discriminator('DirectMessageNotification', schema);
