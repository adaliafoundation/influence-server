const mongoose = require('mongoose');
const { isNil } = require('lodash');
const { Address } = require('@influenceth/sdk');
const { toBoolean } = require('@common/lib/utils');

class UserService {
  static findByAddress(address) {
    if (isNil(address)) throw new Error('Address is required');
    return mongoose.model('User').findOne({ address: Address.toStandard(address) });
  }

  static async findOrCreateByAddress({ address, isDeployed, referredBy }) {
    if (!address) throw new Error('Address is required');
    const stdAddress = Address.toStandard(address);
    const filter = { address: stdAddress };
    const update = { address: stdAddress, isDeployed };
    const opts = { upsert: true, new: true };

    if (referredBy) update.$setOnInsert = { referredBy: Address.toStandard(referredBy) };

    const result = await mongoose.model('User').updateOne(filter, update, opts);
    return (result.upsertedId) ? mongoose.model('User').findById(result.upsertedId)
      : mongoose.model('User').findOne(filter);
  }

  static watchAsteroid({ asteroid, tags, user }) {
    if (user.hasWatchedAsteroid(asteroid)) throw new Error('Already watching asteroid.');
    user.addWatchedAsteroid({ asteroid, tags });
    return user.save();
  }

  static unwatchAsteroid({ asteroid, user }) {
    if (!user.hasWatchedAsteroid(asteroid)) throw new Error('Asteroid not being watched');
    user.removeWatchedAsteroid(asteroid);
    user.markModified('watchlist');
    return user.save();
  }

  // TODO: Need to validate the watchListData before writing it
  static updateWatchList({ user, watchListData }) {
    user.set('watchlist', watchListData);
    user.save();
  }

  static async updateDirectMessagingKeys({ address, user, messagingKeys }) {
    if (!user && !address) throw new Error('User or address is required');
    const userDoc = (address) ? await this.findByAddress(address) : user;

    if (!userDoc) throw new Error('User not found');

    userDoc.set('directMessagingKeys', messagingKeys);
    userDoc.save();
  }

  static async updateByAddress({
    address,
    update: {
      directMessagingSeed,
      email,
      notificationSubscriptions = {}
    } = {}
  }) {
    const user = await this.findByAddress(address);
    if (!user) throw new Error('User not found');

    if (email) user.set('email', email);

    if (!isNil(notificationSubscriptions.CREW)) {
      user.set('notificationSubscriptions.CREW', toBoolean(notificationSubscriptions.CREW));
    }
    if (!isNil(notificationSubscriptions?.LEASE)) {
      user.set('notificationSubscriptions.LEASE', toBoolean(notificationSubscriptions.LEASE));
    }
    if (!isNil(notificationSubscriptions?.TASK)) {
      user.set('notificationSubscriptions.TASK', toBoolean(notificationSubscriptions.TASK));
    }
    if (!isNil(notificationSubscriptions?.DIRECT_MESSAGE)) {
      user.set('notificationSubscriptions.DIRECT_MESSAGE', toBoolean(notificationSubscriptions.DIRECT_MESSAGE));
    }

    if (!isNil(directMessagingSeed)) user.set('directMessagingSeed', directMessagingSeed);

    return (user.isModified()) ? user.save() : user;
  }
}

module.exports = UserService;
