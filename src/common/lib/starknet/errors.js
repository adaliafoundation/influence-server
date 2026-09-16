const { RpcError } = require('starknet');

const isContractNotDeployedError = (error) => error instanceof RpcError && error.isType('CONTRACT_NOT_FOUND');

module.exports = { isContractNotDeployedError };
