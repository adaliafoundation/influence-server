const appConfig = require('config');
const mongoose = require('mongoose');
const { entitiesPlugin } = require('./plugins');

// register global plugins
mongoose.plugin(entitiesPlugin, { tags: ['useEntitiesPlugin'] });

// disable auto index creation
mongoose.set('autoIndex', appConfig.MongoDb?.autoIndex || false);

// load all models
require('./models');

// init db connection
mongoose.set('bufferTimeoutMS', 30000);
mongoose.connect(appConfig.get('MongoDb.uri'));

mongoose.set('debug', Number(appConfig.MongoDb?.debug || 0) === 1);

module.exports = {
  db: mongoose.connection,
  mongoose
};
