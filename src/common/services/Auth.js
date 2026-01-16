const appConfig = require('config');
const { Address } = require('@influenceth/sdk');
const uuid = require('short-uuid');
const starknet = require('starknet');
const UserService = require('@common/services/User');
const { AuthCache } = require('@common/lib/cache');
const logger = require('@common/lib/logger');

class AuthService {
  static CHALLENGE_TIME_LIMIT = 3 * 60e3;

  static isEnvCheckEnabled(value) {
    return Number(value) === 1 || value === 'true';
  }

  static getTypedMessage(nonce) {
    const chainId = appConfig?.Starknet?.chainId || null;
    if (!chainId) logger.warn('Starknet.chainId not found in config');

    return {
      domain: { name: 'Influence', chainId, version: '1.1.0' },
      message: { message: 'Login to Influence', nonce },
      primaryType: 'Message',
      types: {
        Message: [
          { name: 'message', type: 'string' },
          { name: 'nonce', type: 'string' }
        ],
        StarkNetDomain: [
          { name: 'name', type: 'felt' },
          { name: 'chainId', type: 'felt' },
          { name: 'version', type: 'felt' }
        ]
      }
    };
  }

  /**
   * Returns a challenge message valid for a short period of time
   * @param {String} address
   * @returns {Object} message
   */
  static async getChallenge(address) {
    if (!address) throw new Error('Address is required');

    const _address = Address.toStandard(address);
    const nonce = uuid.generate();

    await AuthCache.setLoginMessage(_address, nonce, this.CHALLENGE_TIME_LIMIT);

    return this.getTypedMessage(nonce);
  }

  static hasAccessToEnvironment({ user }) {
    const ENV_CHECK_ENABLED = appConfig.get('App.envCheckEnabled');
    const NODE_ENV = appConfig.util.getEnv('NODE_ENV');

    // confirm environment check is enabled
    // if not enabled, return tru now
    if (!this.isEnvCheckEnabled(ENV_CHECK_ENABLED)) return true;

    // Enfironment check enabled, user must have an entry for NODE_ENV in their envAccess
    if ((user.envAccess || []).includes(NODE_ENV)) return true;

    // last case return false
    return false;
  }

  /**
   * Validates a signed message from a given address and checks against cache
   * @param {Object} {String} address {String} signature
   * @returns {Object} user
   */
  static async verifyChallenge({ address, message, referredBy, signature }) {
    const _address = Address.toStandard(address);
    const nonce = await AuthCache.getLoginMessage(_address);
    const chainId = appConfig?.Starknet?.chainId || null;
    if (!chainId) logger.warn('Starknet.chainId not found in config');

    // Cache miss means request took too long or need to call /auth/login first
    if (!nonce) throw new Error('Authentication code expired. Please try again.');

    // Nonce has now been used, so remove from cache to avoid replay attacks
    await AuthCache.deleteLoginMessage(_address);
    const provider = new starknet.RpcProvider({ nodeUrl: appConfig.get('Starknet.rpcProvider') });

    // If the account contract isn't deployed yet, issue a token (while this appears unsafe, the only
    // thing the user could do is update preferences, watchlist, etc. and if they were spoofing an
    // account they would lose it all as soon as the actual account was deployed).
    let isDeployed;

    try {
      await provider.getClassAt(_address, 'latest');
      isDeployed = true;
    } catch (error) {
      logger.warn(`Auth: account at ${_address} not yet deployed`);
      isDeployed = false;
    }

    // check that signature is valid
    // (i.e. signed by the passedAddress on the expected network, valid for the nonce'd payload)
    if (isDeployed) {
      let valid;

      let messageToHash;

      // If there's a session message passed, verify the chain and expiration
      if (message && message.domain?.name === 'ArgentSession') {
        if (message.domain?.chainId !== chainId || message.message?.expirationTime < Date.now() / 1000) {
          throw new Error('Invalid session message');
        }

        messageToHash = message;
      } else if (message && message.domain?.name === 'SessionAccount.session') {
        if (message.domain?.chainId !== chainId || message.message?.['Expires At'] < Date.now() / 1000) {
          throw new Error('Invalid session message');
        }

        messageToHash = message;
      } else {
        messageToHash = this.getTypedMessage(nonce);
      }

      try {
        const hash = starknet.typedData.getMessageHash(messageToHash, _address);
        const compiled = starknet.CallData.compile({
          hash: BigInt(hash).toString(),
          signature: signature.split(',').map((x) => BigInt(x).toString())
        });

        const result = await provider.callContract({
          contractAddress: _address,
          entrypoint: 'is_valid_signature',
          calldata: compiled
        });

        valid = BigInt(result[0]) > 0n;
      } catch (e) {
        logger.warn(e);
        logger.warn('verifyMessage error', e);
      }

      if (!valid) throw new Error('Signature invalid.');
    }

    // Use the passed address which is properly standardized
    return UserService.findOrCreateByAddress({ address: _address, isDeployed, referredBy });
  }
}

module.exports = AuthService;
