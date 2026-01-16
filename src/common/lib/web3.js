const appConfig = require('config');
const { FMT_BYTES, FMT_NUMBER, Web3 } = require('web3');

const instance = new Web3(appConfig.get('Ethereum.provider'));
instance.eth.defaultReturnFormat = { bytes: FMT_BYTES.HEX, number: FMT_NUMBER.NUMBE };

module.exports = instance;
