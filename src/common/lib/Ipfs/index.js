const IpfsRpcClient = require('@common/lib/Ipfs/RpcClient');
const appConfig = require('config');

const gatewayUrl = (cid) => {
  const base = appConfig.get('Ipfs.gatewayUrl');
  if (!base) throw new Error('IPFS_GATEWAY_URL is not configured');
  return `${base.replace(/\/$/, '')}/ipfs/${cid}`;
};

module.exports = {
  IpfsRpcClient,
  gatewayUrl
};
