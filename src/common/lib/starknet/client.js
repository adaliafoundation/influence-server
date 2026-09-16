const starknet = require('starknet');

const createRpcProvider = async ({ nodeUrl, ...props } = {}) => {
  if (!nodeUrl) throw new Error('Starknet RPC endpoint is required');
  return starknet.RpcProvider.create({ nodeUrl, ...props });
};

const createAccount = ({
  provider,
  address,
  signer,
  cairoVersion,
  transactionVersion,
  ...props
} = {}) => new starknet.Account({
  provider,
  address,
  signer,
  cairoVersion,
  transactionVersion,
  ...props
});

const createContract = ({ abi, address, providerOrAccount, ...props } = {}) => new starknet.Contract({
  abi,
  address,
  providerOrAccount,
  ...props
});

module.exports = {
  starknet,
  createAccount,
  createContract,
  createRpcProvider
};
