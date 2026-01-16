const { Schema } = require('mongoose');
const EventModel = require('../Event');

const schema = new Schema({
  id: { type: String }
});

module.exports = EventModel.discriminator('Ethereum', schema);
