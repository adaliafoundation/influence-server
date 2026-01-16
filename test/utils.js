const appConfig = require('config');
const { castArray } = require('lodash');
const mongoose = require('mongoose');

const INITAL_NODE_ENV = appConfig.util.getEnv('NODE_ENV');

const switchNodeEnv = function (env) {
  Object.assign(process.env, { NODE_ENV: env });
};

const restoreNodeEnv = function () {
  Object.assign(process.env, { NODE_ENV: INITAL_NODE_ENV });
};

const resetCollections = function (modelNames) {
  return Promise.all(castArray(modelNames).map((modelName) => mongoose.model(modelName).deleteMany({})));
};

module.exports = {
  resetCollections,
  restoreNodeEnv,
  switchNodeEnv
};
