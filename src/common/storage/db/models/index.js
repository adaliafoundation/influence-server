const Activity = require('./Activity');
const ApiKey = require('./ApiKey');
const AsteroidSale = require('./AsteroidSale');
const Constant = require('./Constant');
const Crossing = require('./Crossing');
const DirectMessage = require('./DirectMessage');
const Entity = require('./Entity');
const Entropy = require('./Entropy');
const Event = require('./Event');
const EventAnnotation = require('./EventAnnotation');
const { Ethereum, Starknet } = require('./Events');
const Faucet = require('./Faucet');
const IndexItem = require('./IndexItem');
const Notification = require('./Notification');
const NotificationModels = require('./Notifications');
const Referral = require('./Referral');
const SwayClaim = require('./SwayClaim');
const SwayCrossing = require('./SwayCrossing');
const User = require('./User');

const componentModels = require('./Components');

module.exports = {
  Activity,
  ApiKey,
  AsteroidSale,
  Constant,
  Crossing,
  DirectMessage,
  Entity,
  Entropy,
  Event,
  EventAnnotation,
  Faucet,
  IndexItem,
  Notification,
  ...NotificationModels,
  Referral,
  SwayClaim,
  SwayCrossing,
  User,
  Ethereum,
  Starknet,
  ...componentModels
};
