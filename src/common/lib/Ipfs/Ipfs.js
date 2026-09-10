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
  static serialize(data) {
    if (isObject(data)) return JSON.stringify(data);
    if (isString(data)) return data;
    throw new Error('Ipfs::serialize: Invalid data type');
  }

  static hashData(data) {
    return hashContent(this.serialize(data));
  }
}

module.exports = Ipfs;
