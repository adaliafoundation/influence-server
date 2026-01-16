const EthereumHandlers = require('./ethereum');
const StarknetHandlers = require('./starknet');

module.exports = {
  ethereum: EthereumHandlers,
  starknet: StarknetHandlers
};
