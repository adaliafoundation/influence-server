const Hash = require('ipfs-only-hash');
const { isObject, isString } = require('lodash');

class Ipfs {
  static hashData(data) {
    if (isObject(data)) return Hash.of(JSON.stringify(data));
    if (isString(data)) return Hash.of(data);
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
