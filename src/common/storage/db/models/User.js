const mongoose = require('mongoose');
const { isNil, remove } = require('lodash');
const { Address } = require('@influenceth/sdk');
const { Hex } = require('@common/storage/db/helpers');
const toJsonPlugin = require('../plugins/toJson');

const addWatchedAsteroid = function ({ asteroid, tags }) {
  if (!this.hasWatchedAsteroid(Number(asteroid))) this.watchlist.push({ asteroid, tags });
};

const removeWatchedAsteroid = function (asteroid) {
  remove(this.watchlist, (item) => item.asteroid === Number(asteroid));
};

const hasWatchedAsteroid = function (asteroid) {
  return !!this.watchlist.some((item) => item.asteroid === Number(asteroid));
};

const hasAnyNoficationSubscriptionEnabled = function () {
  return Object.values(this.notificationSubscriptions).some((value) => value);
};

const notificationSubscriptionEnabled = function (notificationType) {
  return this.notificationSubscriptions[notificationType];
};

const findByAddress = function (address) {
  if (isNil(address)) throw new Error('Address is required');
  return this.findOne({ address: Address.toStandard(address) });
};

const preSave = function () {
  // Standardize address
  if (!isNil(this.address)) this.address = Address.toStandard(this.address);
};

const watchlistSchema = new mongoose.Schema({
  asteroid: { type: Number },
  tags: [String] // Tags to categorize watchlist
});

const userSchema = new mongoose.Schema({
  address: { type: String, set: Address.toStandard, required: true },
  directMessagingSeed: { type: String }, // TODO: keep this private
  directMessagingKeys: {
    x: { type: String, set: Hex.toHex64 },
    y: { type: String, set: Hex.toHex64 }
  },
  email: { type: String },
  envAccess: [{ type: String, enum: ['staging', 'prerelease'] }],
  isDeployed: { type: Boolean },
  notificationSubscriptions: {
    CREW: { type: Boolean, default: true },
    DIRECT_MESSAGE: { type: Boolean, default: true },
    LEASE: { type: Boolean, default: true },
    TASK: { type: Boolean, default: true }
  },
  referredBy: { type: String, set: Address.toStandard },
  watchlist: [watchlistSchema]
});

userSchema.virtual('hasSeed').get(function () {
  return !!this.directMessagingSeed;
});

userSchema.virtual('publicKey').get(function () {
  if (this.directMessagingKeys.x && this.directMessagingKeys.y) {
    return `04${this.directMessagingKeys.x.substr(2)}${this.directMessagingKeys.y.substr(2)}`;
  }
  return null;
});

userSchema
  .plugin(toJsonPlugin, { omit: ['directMessagingSeed'] })
  .pre('save', preSave)
  .method('hasWatchedAsteroid', hasWatchedAsteroid)
  .method('addWatchedAsteroid', addWatchedAsteroid)
  .method('hasAnyNoficationSubscriptionEnabled', hasAnyNoficationSubscriptionEnabled)
  .method('notificationSubscriptionEnabled', notificationSubscriptionEnabled)
  .method('removeWatchedAsteroid', removeWatchedAsteroid)
  .static('findByAddress', findByAddress)
  .index({ address: 1 }, { unique: true })
  .index({ address: 1, email: 1 });

module.exports = mongoose.model('User', userSchema);
