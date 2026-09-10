const appConfig = require('config');
const { db } = require('../storage/db');
const { createWorkerHealth, healthSettings } = require('./health');

module.exports = (role) => createWorkerHealth({
  collection: db.collection('workerhealth'), settings: healthSettings(appConfig), role
});
