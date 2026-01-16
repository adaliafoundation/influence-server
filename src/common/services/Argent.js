const axios = require('axios');
const { isArray } = require('lodash');
const { hash, num: { toHex } } = require('starknet');
const appConfig = require('config');

class ArgentService {
  static deployAccount({ calldata, class_hash: classHash, salt }) {
    const uri = appConfig.get('Argent.uri');
    const path = appConfig.get('Argent.relayerPath');
    const apiKey = appConfig.get('Argent.apiKey');
    const udc = appConfig.get('Contracts.starknet.udc');

    if (!isArray(calldata) || calldata.length === 0 || !classHash || !salt) {
      throw new Error('Invalid/missing parameters');
    }

    const body = {
      calls: [{
        contractAddress: udc,
        entrypoint: hash.getSelectorFromName('deployContract'),
        calldata: [
          classHash,
          salt,
          '0x0', // always 0
          toHex(calldata.length),
          ...calldata
        ]
      }]
    };

    const options = { headers: { 'X-Argent-Api-Key': apiKey }, responseType: 'json' };

    return axios.post(`${uri}${path}`, body, options);
  }
}

module.exports = ArgentService;
