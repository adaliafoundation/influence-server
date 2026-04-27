const appConfig = require('config');
const { DefaultStarknetProvider, RpcProvider } = require('./providers');
const logger = require('../logger');

class StarknetProvider {
  _providers = [];

  constructor({ providers, ...props } = {}) {
    // store any other props passed in
    this.props = props;

    // set/init the providers
    this.providers = providers;
  }

  get providers() {
    return this._providers;
  }

  set providers(providers) {
    const STARKNET_RPC_PROVIDER = appConfig.get('Starknet.rpcProvider');

    // validate and set specified providers
    if ((providers || []).length > 0) {
      providers.forEach((provider) => {
        if (!(provider instanceof DefaultStarknetProvider)) {
          throw new Error('provider not instance of DefaultStarknetProvider');
        }
        this._providers.push(provider);
      });
    } else {
      const {
        rpcEndpoint = STARKNET_RPC_PROVIDER,
        ...providerProps
      } = this.props;

      // set default providers is non provided
      this._providers.push(new RpcProvider({ endpoint: rpcEndpoint, ...providerProps }));
    }
  }

  async getEvents({ address, addresses, fromBlock, toBlock }, options = {}) {
    for (let p = 0; p < this.providers.length; p += 1) {
      try {
        logger.verbose(`getEvents, using provider: ${this.providers[p].constructor.name}`);
        const events = await this.providers[p].getEvents({ address, addresses, fromBlock, toBlock }, options);
        return events;
      } catch (error) {
        logger.warn(`StarknetProvider::getEvents, ${error.e || error}`);
      }
    }
    throw new Error('StarknetProvider::getEvents, all providers failed');
  }

  async getBlock(blockNumber, options = {}) {
    let block;
    for (let p = 0; p < this.providers.length; p += 1) {
      try {
        logger.verbose(`getBlock (${blockNumber}), using provider: ${this.providers[p].constructor.name}`);
        block = await this.providers[p].getBlock(blockNumber, options);
        return block;
      } catch (error) {
        logger.warn(`StarknetProvider::getBlock, ${error.e || error}`);
      }
    }
    throw new Error('StarknetProvider::getBlock, all providers failed');
  }

  async getBlockNumber(options = {}) {
    let block;
    for (let p = 0; p < this.providers.length; p += 1) {
      try {
        logger.verbose(`getBlockNumber, using provider: ${this.providers[p].constructor.name}`);
        block = await this.providers[p].getBlockNumber(options);
        return block;
      } catch (error) {
        logger.warn(`StarknetProvider::getBlockNumber, ${error.e || error}`);
      }
    }
    throw new Error('StarknetProvider::getBlockNumber, all providers failed');
  }
}

module.exports = StarknetProvider;
