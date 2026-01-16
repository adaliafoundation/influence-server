const mongoose = require('mongoose');
const Joi = require('joi');
const { Address } = require('@influenceth/sdk');
const { isNil, isObject, pick } = require('lodash');
const { InfuraIpfs } = require('@common/lib/Ipfs');
const DirectMessageNotificationService = require('./Notifications/DirectMessage');
const UserService = require('./User');

class DirectMessageService {
  static MAX_MESSAGE_SIZE = 10_240; // In Bytes

  static MIN_MESSAGE_SIZE = 52; // In Bytes

  static async findOrCreate({
    caller,
    contentHash,
    event,
    message,
    pin = false,
    recipient }) {
    if (!caller) throw new Error('DirectMessageService::findOrCreate: Missing required parameter: caller');
    if (!event?.transactionHash || isNil(event?.logIndex)) {
      throw new Error('DirectMessageService::findOrCreate: Missing required parameter: event');
    }

    let _contentHash = contentHash;
    const _caller = Address.toStandard(caller, 'starknet');

    if (!_contentHash && message) {
      this.validate(message);
      _contentHash = await InfuraIpfs.hashData(message);
    }

    // Find recipient to confirm is a game user
    const recipientUser = await UserService.findByAddress(recipient);
    if (!recipientUser) throw new Error('DirectMessageService::findOrCreate: Recipient not found.');

    // Find DirectMessageSent event (to confirm event exists and has been processed)
    const messagedEvent = await mongoose.model('Starknet').findOne({
      event: 'DirectMessageSent',
      transactionHash: event.transactionHash,
      logIndex: event.logIndex
    });
    if (!messagedEvent) {
      throw new Error('DirectMessageService::findOrCreate: DirectMessageSent event not found.');
    }

    // validate against event
    if (messagedEvent.returnValues.caller !== _caller
      || messagedEvent.returnValues.recipient !== recipientUser.address
      || messagedEvent.returnValues.contentHash !== _contentHash) {
      throw new Error('DirectMessageService::findOrCreate: Invalid event and/or data specified.');
    }

    // If content is provided, validate and upload
    if (message) {
      this.validate(message);
      const ipfs = new InfuraIpfs();
      const result = await ipfs.addData(message, { pin });
      _contentHash = result.hash;
    }

    const filter = {
      sender: _caller,
      recipient: recipientUser.address,
      'ipfs.hash': _contentHash,
      'event.transactionHash': event.transactionHash,
      'event.logIndex': event.logIndex
    };

    const update = {
      event: pick(messagedEvent.toJSON(), ['logIndex', 'timestamp', 'transactionHash']),
      ipfs: { hash: messagedEvent.returnValues.contentHash, service: 'infura', pinned: pin },
      recipient: recipientUser.address,
      sender: _caller
    };

    const result = await mongoose.model('DirectMessage').findOneAndUpdate(filter, update, { upsert: true, new: true });

    // create a notification
    await DirectMessageNotificationService.createOrUpdate(result);

    return result;
  }

  static findByRecipient(recipient) {
    return mongoose.model('DirectMessage').find({ recipient }).select({ __v: false });
  }

  static findBySenderOrRecipient(address) {
    const _address = Address.toStandard(address, 'starknet');
    return mongoose.model('DirectMessage')
      .find({ $or: [{ recipient: _address }, { sender: _address }] })
      .select({ __v: false });
  }

  static hashData(data) {
    return InfuraIpfs.hashData(data);
  }

  static markRead(id, recipient) {
    const _recipient = Address.toStandard(recipient, 'starknet');
    return mongoose.model('DirectMessage').updateOne({ _id: id, recipient: _recipient }, { read: true, upsert: false });
  }

  static validate(data) {
    const validationSchema = Joi.object({
      content: Joi.object({ sender: Joi.object(), recipient: Joi.object() })
        .required(),
      type: Joi.string()
        .pattern(/^DirectMessage$/)
        .required(),
      version: Joi.number()
        .min(1)
        .required()
    });
    const _data = (isObject(data)) ? data : JSON.parse(data);

    // validate size
    const size = Buffer.byteLength(JSON.stringify(_data), 'utf8');
    if (size > this.MAX_MESSAGE_SIZE || size < this.MIN_MESSAGE_SIZE) {
      throw new Error(`DirectMessageService::validate: Invalid size: ${size}`);
    }

    // validate structure
    const validationResult = validationSchema.validate(_data);
    if (validationResult.error) {
      throw new Error(`DirectMessageService::validate: Invalid structure: ${validationResult.error.message}`);
    }
  }
}

module.exports = DirectMessageService;
