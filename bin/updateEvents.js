require('dotenv').config({ silent: true })

// Setup db connection and grab relevant models
const mongoose = require('mongoose');
mongoose.connect(process.env.MONGO_URL);
const db = mongoose.connection;

const run = async function () {
  const args = process.argv.slice(2);
  const type = args[0];
  let records;

  if (type === 'asteroids') {
    const Asteroid = require('../models/Asteroid');
    records = await Asteroid.find({ owner: { $exists: true }}).sort({ i: 1 }).exec();
  } else if (type === 'crew') {
    const CrewMember = require('../models/CrewMember');
    records = await CrewMember.find().sort({ i: 1 }).exec();
  } else {
    process.exit();
  }

  let record;

  for (let i = 0; i < records.length; i++) {
    try {
      record = records[i];
      await record.onEventsChanged();
    } catch (e) {
      console.log('Failed updating:', record.i);
      console.error(e);
    }
  }

  process.exit();
};

run();
