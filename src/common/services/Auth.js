const appConfig = require('config');
const { Address } = require('@influenceth/sdk');
const uuid = require('short-uuid');
const starknetClient = require('@common/lib/starknet/client');
const UserService = require('@common/services/User');
const { AuthCache } = require('@common/lib/cache');
const logger = require('@common/lib/logger');

class AuthService {
  static CHALLENGE_TIME_LIMIT = 3 * 60e3;

  static CARTRIDGE_SESSION_SIGNATURE_MARKER = 'session-typed-data';

  static CARTRIDGE_SESSION_TOKEN_START = 7;

  static isEnvCheckEnabled(value) {
    return Number(value) === 1 || value === 'true';
  }

  static signatureToFelts(signature) {
    return signature.split(',').map((x) => BigInt(x).toString());
  }

  static isCartridgeSessionSignature(signature) {
    const [marker] = signature.split(',');
    if (!marker) return false;

    const encodedMarker = starknetClient.starknet.shortString.encodeShortString(
      this.CARTRIDGE_SESSION_SIGNATURE_MARKER
    );
    return BigInt(marker) === BigInt(encodedMarker);
  }

  static cartridgeSessionCalldata(message, signature) {
    const domainHash = starknetClient.starknet.typedData.getStructHash(
      message.types,
      'StarkNetDomain',
      message.domain,
      '1'
    );
    const typeHash = starknetClient.starknet.typedData.getTypeHash(message.types, message.primaryType, '1');
    const scopeHash = starknetClient.starknet.hash.computePoseidonHash(domainHash, typeHash);
    const typedDataHash = starknetClient.starknet.typedData.getStructHash(
      message.types,
      message.primaryType,
      message.message,
      '1'
    );
    const sessionToken = this.signatureToFelts(signature).slice(this.CARTRIDGE_SESSION_TOKEN_START);

    return [
      1,
      scopeHash,
      typedDataHash,
      ...sessionToken
    ];
  }

  static getTypedMessage(nonce) {
    const chainId = appConfig?.Starknet?.chainId || null;
    if (!chainId) logger.warn('Starknet.chainId not found in config');

    return {
      domain: { name: 'Influence', version: '1.1.0', chainId },
      message: { message: 'Login to Influence', nonce },
      primaryType: 'Message',
      types: {
        Message: [
          { name: 'message', type: 'string' },
          { name: 'nonce', type: 'string' }
        ],
        StarkNetDomain: [
          { name: 'name', type: 'felt' },
          { name: 'version', type: 'felt' },
          { name: 'chainId', type: 'felt' }
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
    const provider = await starknetClient.createRpcProvider({ nodeUrl: appConfig.get('Starknet.rpcProvider') });

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
      // If there's a session message passed, verify the chain and expiration
      if (message && message.domain?.name === 'ArgentSession') {
        if (message.domain?.chainId !== chainId || message.message?.expirationTime < Date.now() / 1000) {
          throw new Error('Invalid session message');
        }

        await this.verifyStarknetSignature({ address: _address, message, provider, signature });
      } else if (this.isCartridgeSessionSignature(signature)) {
        await this.verifyCartridgeSessionSignature({
          address: _address,
          message: this.getTypedMessage(nonce),
          provider,
          signature
        });
      } else {
        await this.verifyStarknetSignature({
          address: _address,
          message: this.getTypedMessage(nonce),
          provider,
          signature
        });
      }
    }

    // Use the passed address which is properly standardized
    return UserService.findOrCreateByAddress({ address: _address, isDeployed, referredBy });
  }

  static async verifyCartridgeSessionSignature({
    address,
    message,
    provider,
    signature
  }) {
    try {
      const result = await provider.callContract({
        contractAddress: address,
        entrypoint: 'is_session_signature_valid',
        calldata: this.cartridgeSessionCalldata(message, signature)
      });

      if (BigInt(result[0]) > 0n) return;
    } catch (e) {
      logger.warn(e);
      logger.warn('verifyCartridgeSessionSignature error', e);
    }

    throw new Error('Signature invalid.');
  }

  static async verifyStarknetSignature({
    address,
    message,
    provider,
    signature
  }) {
    try {
      const hash = starknetClient.starknet.typedData.getMessageHash(message, address);
      const compiled = starknetClient.starknet.CallData.compile({
        hash: BigInt(hash).toString(),
        signature: this.signatureToFelts(signature)
      });

      const result = await provider.callContract({
        contractAddress: address,
        entrypoint: 'is_valid_signature',
        calldata: compiled
      });

      if (BigInt(result[0]) > 0n) return;
    } catch (e) {
      logger.warn(e);
      logger.warn('verifyMessage error', e);
    }

    throw new Error('Signature invalid.');
  }
}

module.exports = AuthService;
