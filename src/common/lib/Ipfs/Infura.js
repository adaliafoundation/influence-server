const fs = require('fs');
const axios = require('axios');
const appConfig = require('config');
const { isObject } = require('lodash');
const Ipfs = require('./Ipfs');

class InfuraIpfs extends Ipfs {
  constructor({ endpoint, key, keySecret } = {}) {
    super();
    this._endpoint = endpoint || appConfig.get('Ipfs.infura.endpoint');
    this._key = key || appConfig.get('Ipfs.infura.apiKey');
    this._keySecret = keySecret || appConfig.get('Ipfs.infura.apiKeySecret');
  }

  _add(formData, { pin = false } = {}) {
    return axios.post(`${this._endpoint}/add?quieter=true&pin=${pin}`, formData, {
      auth: { username: this._key, password: this._keySecret },
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  }

  async pin(hash) {
    return axios.post(`${this._endpoint}/pin/add?arg=${hash}`, null, {
      auth: { username: this._key, password: this._keySecret },
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  }

  /**
   * Add a file to IPFS
   *
   * @param {String} file
   * @param {Object} options
   * @returns { hash: String }
   */
  async addFile(file, options) {
    const formData = new FormData(); // eslint-disable-line no-undef
    formData.append('file', fs.createReadStream(file));

    const response = await this._add(formData, options);

    if (response.data.error) {
      throw new Error(`InfuraIpfs::addFile error: ${JSON.stringify(response.data.error)}`);
    }

    return { hash: response.data.Hash };
  }

  /**
   * Add data to IPFS
   *
   * @param {String} data
   * @param {Object} options
   * @returns { hash: String }
   */
  async addData(data, options) {
    const _data = Buffer.from((isObject(data)) ? JSON.stringify(data) : data);
    const formData = new FormData(); // eslint-disable-line no-undef
    formData.append('file', _data);

    const response = await this._add(formData, options);

    if (response.data.error) {
      throw new Error(`InfuraIpfs::addData error: ${JSON.stringify(response.data.error)}`);
    }

    return { hash: response.data.Hash };
  }

  async cat(hash) {
    const response = await axios.post(`${this._endpoint}/cat?arg=${hash}`, {}, {
      auth: { username: this._key, password: this._keySecret },
      responseType: 'text'
    });

    if (response.data.error) {
      throw new Error(`InfuraIpfs::info error: ${JSON.stringify(response.data.error)}`);
    }

    return response.data;
  }

  async size(hash) {
    const response = await axios.post(`${this._endpoint}/block/stat?arg=${hash}`, {}, {
      auth: { username: this._key, password: this._keySecret }
    });

    if (response.data.error) {
      throw new Error(`InfuraIpfs::info error: ${JSON.stringify(response.data.error)}`);
    }

    if (!response.data?.Size) throw new Error('InfuraIpfs::info error: No size returned');

    return response.data.Size;
  }
}

module.exports = InfuraIpfs;
