const { reduce } = require('lodash');

const plugin = function (schema, keys = []) {
  const uniquePath = function () {
    return reduce(keys, (acc, key) => {
      acc[key] = this.get(key);
      return acc;
    }, {});
  };

  schema
    .method('uniquePath', uniquePath);
};

module.exports = plugin;
