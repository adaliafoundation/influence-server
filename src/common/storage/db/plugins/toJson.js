const { chain, compact, isNil } = require('lodash');

module.exports = (schema, settings = {}) => {
  const defaults = {
    virtuals: true,
    versionKey: false,
    getters: true,
    transform: (doc, ret) => chain(ret)
      .omitBy(isNil)
      .mapValues((val) => ((val instanceof Array) ? compact(val) : val))
      .omit(settings.omit || ['_id'])
      .value()
  };
  schema.set('toJSON', { ...defaults, ...settings });
};
