require('dotenv').config({ silent: true })

// Setup db connection and grab relevant models
const mongoose = require('mongoose');
mongoose.connect(process.env.MONGO_URL);
const db = mongoose.connection;

const run = async function () {
  const args = process.argv.slice(2);
  const type = args[0];

  if (type === 'asteroids') {
    const AsteroidModel = require('../models/Asteroid');
    
    for await (const asteroid of AsteroidModel.find({ owner: { $ne: null }}).cursor()) {
      await asteroid.notifyMarketplaces();
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  } else if (type === 'crew') {
    const CrewMemberModel = require('../models/CrewMember');

    for await (const crewmate of CrewMemberModel.find().sort({ i: -1 }).cursor()) {
      await crewmate.notifyMarketplaces();
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }

  process.exit();
};

run();
