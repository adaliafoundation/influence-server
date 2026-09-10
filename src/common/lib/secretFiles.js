const { readFileSync } = require('fs');

// Only explicitly supported settings can be supplied through secret files.
const SECRET_PATHS = {
  JWT_SECRET: 'App.jwtSecret',
  ARGENT_API_KEY: 'Argent.apiKey',
  AVNU_PAYMASTER_API_KEY: 'Avnu.paymasterApiKey',
  AVNU_PAYMASTER_URL: 'Avnu.paymasterUrl',
  BANXA_API_KEY: 'Banxa.apiKey',
  BANXA_BASE_URL: 'Banxa.baseUrl',
  BANXA_WEBHOOK_API_KEY: 'Banxa.webhookApiKey',
  BANXA_WEBHOOK_SECRET: 'Banxa.webhookSecret',
  ELASTICSEARCH_URL: 'Elasticsearch.uri',
  ETHEREUM_PROVIDER: 'Ethereum.provider',
  IPFS_INFURA_API_KEY: 'Ipfs.infura.apiKey',
  IPFS_INFURA_API_KEY_SECRET: 'Ipfs.infura.apiKeySecret',
  MONGO_URL: 'MongoDb.uri',
  OPEN_SEA_API_KEY: 'OpenSea.key',
  REDIS_URL: 'Redis.uri',
  SENDGRID_API_KEY: 'SendGrid.apiKey',
  STARKNET_RPC_PROVIDER: 'Starknet.rpcProvider',
  STARKNET_EVENT_RETRIEVER_RPC_PROVIDER: 'EventRetriever.starknet.rpcProvider',
  STARKNET_FAUCET_PRIVATE_KEY: 'Starknet.faucetPrivateKey',
  STARKNET_STARTER_PACK_PRIVATE_KEY: 'Starknet.starterPackPrivateKey',
  STRIPE_SECRET_KEY: 'Stripe.secretKey',
  STRIPE_WEBHOOK_SECRET: 'Stripe.webhookSecret'
};

function loadSecretFiles(env = process.env) {
  const overrides = {};
  for (const [name, path] of Object.entries(SECRET_PATHS)) {
    const fileVariable = `${name}_FILE`;
    if (env[fileVariable] === undefined) continue; // eslint-disable-line no-continue
    if (env[name]) throw new Error(`Configure only one of ${name} and ${fileVariable}`);
    let value;
    try {
      value = readFileSync(env[fileVariable], 'utf8').trim();
    } catch {
      throw new Error(`Cannot read secret configured by ${fileVariable}`);
    }
    if (!value) throw new Error(`Empty secret configured by ${fileVariable}`);
    const keys = path.split('.');
    const leaf = keys.pop();
    const parent = keys.reduce((result, key) => {
      if (!result[key]) result[key] = {}; // eslint-disable-line no-param-reassign
      return result[key];
    }, overrides);
    parent[leaf] = value;
  }
  return overrides;
}

module.exports = { loadSecretFiles, SECRET_PATHS };
