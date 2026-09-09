const { TextEncoder } = require('node:util');
const { isObject, isString } = require('lodash');

const loadImporter = Promise.all([
  import('ipfs-unixfs-importer'),
  import('blockstore-core/black-hole')
]);

const hashContent = async function (content) {
  const [{ importBytes }, { BlackHoleBlockstore }] = await loadImporter;
  const result = await importBytes(
    new TextEncoder().encode(content),
    new BlackHoleBlockstore(),
    { profile: 'unixfs-v0-2015' }
  );
  return result.cid.toString();
};

class Ipfs {
  static hashData(data) {
    if (isObject(data)) return hashContent(JSON.stringify(data));
    if (isString(data)) return hashContent(data);
    throw new Error('Ipfs::hashData: Invalid data type');
  }

  async addFile() {
    throw new Error('Ipfs::addFile must be implemented in a child class');
  }

  async addData() {
    throw new Error('Ipfs::addData must be implemented in a child class');
  }
}

module.exports = Ipfs;
