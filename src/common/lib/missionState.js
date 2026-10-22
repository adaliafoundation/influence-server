const mongoose = require('mongoose');
const { pathKey } = require('./missions');

const readCells = async (paths) => {
  const cells = await mongoose.model('MissionComponent').find({ pathKey: { $in: paths.map(pathKey) } }).lean();
  const values = new Map(cells.map((cell) => [cell.pathKey, cell.value]));
  return paths.map((path) => values.get(pathKey(path)) || '0');
};

module.exports = { readCells };
