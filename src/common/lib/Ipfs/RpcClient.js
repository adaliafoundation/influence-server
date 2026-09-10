const axios = require('axios');
const appConfig = require('config');
const { Blob } = require('node:buffer');
const Ipfs = require('./Ipfs');

class IpfsRpcClient extends Ipfs {
  constructor({ endpoint = appConfig.get('Ipfs.rpcUrl'),
    authorization = appConfig.get('Ipfs.rpcAuthorization') } = {}) {
    super();
    this.endpoint = endpoint;
    this.authorization = authorization;
  }

  async addData(data, { pin = true } = {}) {
    if (!this.endpoint) {
      const error = new Error('IPFS storage is not configured');
      error.status = 503;
      throw error;
    }

    const content = Ipfs.serialize(data);
    const expectedHash = await Ipfs.hashData(content);
    const form = new FormData(); // eslint-disable-line no-undef
    form.append('file', new Blob([content]), 'content.json');

    let response;
    try {
      response = await axios.post(`${this.endpoint.replace(/\/$/, '')}/add`, form, {
        headers: this.authorization ? { Authorization: this.authorization } : {},
        params: {
          pin,
          quieter: true,
          'cid-version': 0,
          'raw-leaves': false,
          'wrap-with-directory': false,
          chunker: 'size-262144',
          hash: 'sha2-256'
        },
        timeout: 60000
      });
    } catch {
      // Do not expose upstream request details, which include credentials and payloads.
      const error = new Error('IPFS upload failed');
      error.status = 502;
      throw error;
    }

    if (response.data?.Hash !== expectedHash) {
      const error = new Error('IPFS upload returned an unexpected CID');
      error.status = 502;
      throw error;
    }
    return { hash: expectedHash };
  }
}

module.exports = IpfsRpcClient;
