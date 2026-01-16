const { chain, compact, isNil } = require('lodash');

module.exports = (schema, settings = {}) => {
  const defaults = {
    virtuals: true,
    versionKey: false,
    getters: true,
    transform: (doc, ret) => chain(ret)
      .omitBy(isNil)
      .mapValues((val) => ((val instanceof Array) ? compact(val) : val))
      .value()
  };
  schema.set('toObject', { ...defaults, ...settings });
};
