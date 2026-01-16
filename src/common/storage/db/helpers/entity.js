const { isObject } = require('lodash');
const Entity = require('@common/lib/Entity');

const toEntity = function (data) {
  if (!data || !isObject(data)) return undefined;
  const { id, label, uuid } = data;
  if (!id && !label && !uuid) return undefined;
  return ((id && label) || uuid) ? new Entity({ id, label, uuid }) : null;
};

module.exports = {
  toEntity
};
