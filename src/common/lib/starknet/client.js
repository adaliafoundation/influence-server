const starknet = require('starknet');

const createRpcProvider = async ({ nodeUrl, ...props } = {}) => {
  if (typeof starknet.RpcProvider.create === 'function') {
    return starknet.RpcProvider.create({ nodeUrl, ...props });
  }

  return new starknet.RpcProvider({ nodeUrl, ...props });
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

const createContract = ({ abi, address, providerOrAccount, ...props } = {}) => {
  try {
    return new starknet.Contract({
      abi,
      address,
      providerOrAccount,
      ...props
    });
  } catch (error) {
    return new starknet.Contract(abi, address, providerOrAccount);
  }
};

module.exports = {
  starknet,
  createAccount,
  createContract,
  createRpcProvider
};
