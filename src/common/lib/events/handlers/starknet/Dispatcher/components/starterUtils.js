const Entity = require('@common/lib/Entity');

const entityFromPathValue = (value) => Entity.fromUuid(value).toObject();

const readPath = (data) => {
  const pathLength = Number(data.shift());
  const path = data.splice(0, pathLength);
  return path;
};

module.exports = {
  entityFromPathValue,
  readPath
};
