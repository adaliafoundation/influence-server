const appConfig = require('config');
const axios = require('axios');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { hash } = require('starknet');
const { Address } = require('@influenceth/sdk');
const starknetClient = require('@common/lib/starknet/client');
const { ValidationError } = require('@common/lib/errors');

const READ_METHODS = [
  'paymaster_getSupportedTokens',
  'paymaster_isAvailable'
];

const TRANSACTION_METHODS = [
  'paymaster_buildTransaction',
  'paymaster_executeTransaction'
];

const ALLOWED_METHODS = [...READ_METHODS, ...TRANSACTION_METHODS];
const READY_V05_CLASS_HASH = '0x073414441639dcd11d1846f287650a00c60c416b9d3ba45d31c651672125b2c2';
const STARTER_PACK_SPONSORSHIP_DAYS = 14;
const FRI_PER_MILLI_STRK = 10n ** 15n;
const DEPLOY_PURCHASE_STATUSES = ['paid_pending_customization'];
const INVOKE_PURCHASE_STATUSES = ['grant_confirmed'];
const ZERO_ADDRESS = Address.toStandard(0, 'starknet');

const normalizeSelector = (selector) => {
  if (typeof selector === 'string' && selector.startsWith('0x')) return `0x${BigInt(selector).toString(16)}`;
  if (typeof selector === 'string') return hash.getSelectorFromName(selector).toLowerCase();
  return selector?.toString();
};

const normalizeCalldata = (calldata = []) => calldata.map((value) => value.toString());

const callContractAddress = (call) => call.contract_address || call.contractAddress || call.to;
const callSelector = (call) => call.entry_point_selector || call.entrypoint || call.selector;

const paidSinceCutoff = () => new Date(Date.now() - STARTER_PACK_SPONSORSHIP_DAYS * 24 * 60 * 60 * 1000);

const chainId = () => appConfig.get('Starknet.chainId')?.toString();
const budgetMilliStrk = () => Number(appConfig.get('Avnu.paymasterMaxStarterPackBudgetStrk')) * 1000;
const reservationCutoff = () => new Date(
  Date.now() - Number(appConfig.get('Avnu.paymasterReservationTtlSeconds')) * 1000
);

const starterPackPurchaseQuery = ({ recipient, sinceField, statuses }) => ({
  chainId: chainId(),
  [sinceField]: { $gte: paidSinceCutoff() },
  recipient: Address.toStandard(recipient, 'starknet'),
  status: { $in: statuses }
});

const isContractNotDeployedError = (error) => /not deployed|contract not found/i.test(error.message || String(error));
const isBuildMethod = (method) => method === 'paymaster_buildTransaction';
const isExecuteMethod = (method) => method === 'paymaster_executeTransaction';
const isSuccessfulResponse = (response) => response.status >= 200 && response.status < 300 && response.data?.result;

const stableNormalize = (value) => {
  if (Array.isArray(value)) return value.map(stableNormalize);
  if (!value || typeof value !== 'object') return value;

  return Object.keys(value).sort().reduce((result, key) => {
    if (['fee', 'signature'].includes(key)) return result;
    return {
      ...result,
      [key]: stableNormalize(value[key])
    };
  }, {});
};

const fingerprint = (value) => crypto
  .createHash('sha256')
  .update(JSON.stringify(stableNormalize(value)))
  .digest('hex');

const preparedPayloadForBuildResult = (result) => ({
  parameters: result.parameters,
  transaction: stableNormalize(result)
});

const preparedPayloadForExecuteRequest = (body) => ({
  parameters: body.params?.parameters,
  transaction: stableNormalize(body.params?.transaction)
});

const feeFriFromBuildResult = (result) => {
  const fee = result?.fee || {};
  return fee.suggested_max_fee_in_strk
    || fee.estimated_fee_in_strk
    || result?.suggested_max_fee_in_strk
    || result?.estimated_fee_in_strk;
};

const milliStrkFromFeeFri = (feeFri) => {
  const fee = BigInt(feeFri);
  return Number((fee + FRI_PER_MILLI_STRK - 1n) / FRI_PER_MILLI_STRK);
};

class AvnuPaymasterService {
  static async validateRequest({ body, userAddress }) {
    if (!body || Array.isArray(body) || body.jsonrpc !== '2.0' || !ALLOWED_METHODS.includes(body.method)) {
      throw new ValidationError('Invalid paymaster request');
    }

    if (!TRANSACTION_METHODS.includes(body.method)) return null;

    const { parameters, transaction } = body.params || {};
    if (parameters?.fee_mode?.mode !== 'sponsored') {
      throw new ValidationError('Only sponsored paymaster transactions are supported');
    }

    if (isExecuteMethod(body.method)) {
      const purchase = await this.validateExecuteRequest({ body, transaction, userAddress });
      return purchase;
    }

    if (transaction?.type === 'deploy') {
      const purchase = await this.validateDeployTransaction({ transaction, userAddress });
      return purchase;
    }
    if (transaction?.type === 'invoke') {
      const purchase = await this.validateInvokeTransaction({ transaction, userAddress });
      return purchase;
    }

    throw new ValidationError('Unsupported paymaster transaction type');
  }

  static validateUserAddress({ requestAddress: rawRequestAddress, userAddress }) {
    let requestAddress;
    let authenticatedAddress;
    try {
      requestAddress = Address.toStandard(rawRequestAddress, 'starknet');
      authenticatedAddress = Address.toStandard(userAddress, 'starknet');
    } catch (error) {
      throw new ValidationError('Invalid paymaster user address');
    }

    if (requestAddress !== authenticatedAddress) {
      throw new ValidationError('Paymaster user address does not match authenticated user');
    }
  }

  static async starterPackPurchaseForRecipient({ recipient, sinceField, statuses }) {
    return mongoose.model('StarterPackPurchase').findOne(
      starterPackPurchaseQuery({ recipient, sinceField, statuses })
    ).sort({ [sinceField]: -1 });
  }

  static async validateStarterPackEligibility({ recipient, sinceField, statuses }) {
    const purchase = await this.starterPackPurchaseForRecipient({ recipient, sinceField, statuses });
    if (!purchase) throw new ValidationError('No eligible starter pack purchase for paymaster sponsorship');
    return purchase;
  }

  static async validateAccountUndeployed(address) {
    const provider = await starknetClient.createRpcProvider({ nodeUrl: appConfig.get('Starknet.rpcProvider') });
    try {
      await provider.getClassAt(address, 'latest');
    } catch (error) {
      if (isContractNotDeployedError(error)) return;
      throw new ValidationError('Unable to verify account deployment status');
    }
    throw new ValidationError('Account is already deployed');
  }

  static async validateDeployTransaction({ transaction, userAddress }) {
    const { deployment } = transaction;
    if (!deployment || transaction.invoke) throw new ValidationError('Invalid deploy transaction');

    const deploymentAddress = Address.toStandard(deployment.address, 'starknet');
    this.validateUserAddress({ requestAddress: deploymentAddress, userAddress });
    const purchase = await this.validateStarterPackEligibility({
      recipient: deploymentAddress,
      sinceField: 'paidAt',
      statuses: DEPLOY_PURCHASE_STATUSES
    });
    await this.validateAccountUndeployed(deploymentAddress);

    const classHash = Address.toStandard(deployment.class_hash, 'starknet');
    if (classHash !== Address.toStandard(READY_V05_CLASS_HASH, 'starknet')) {
      throw new ValidationError('Unsupported account class hash');
    }
    if (Number(deployment.version) !== 1) throw new ValidationError('Unsupported account deployment version');

    const calldata = normalizeCalldata(deployment.calldata);
    if (calldata.length !== 3) throw new ValidationError('Invalid account deployment calldata');

    const [guardian, publicKey, signerCount] = calldata;
    if (Address.toStandard(guardian, 'starknet') !== ZERO_ADDRESS) {
      throw new ValidationError('Invalid account guardian');
    }
    if (Number(signerCount) !== 1) throw new ValidationError('Invalid account signer count');
    if (BigInt(deployment.salt) !== BigInt(publicKey)) throw new ValidationError('Invalid account deployment salt');

    const calculatedAddress = hash.calculateContractAddressFromHash(
      deployment.salt,
      deployment.class_hash,
      calldata,
      0
    );
    if (Address.toStandard(calculatedAddress, 'starknet') !== deploymentAddress) {
      throw new ValidationError('Account deployment address mismatch');
    }
    return purchase;
  }

  static validateAllowedInvokeCall(call) {
    const contractAddress = Address.toStandard(callContractAddress(call), 'starknet');
    const selector = normalizeSelector(callSelector(call));

    if (
      contractAddress === Address.toStandard(appConfig.get('Contracts.starknet.dispatcher'), 'starknet')
      && selector === hash.getSelectorFromName('run_system').toLowerCase()
    ) return;

    if (
      contractAddress === Address.toStandard(appConfig.get('Contracts.starknet.sway'), 'starknet')
      && selector === hash.getSelectorFromName('transfer_with_confirmation').toLowerCase()
    ) return;

    if (
      contractAddress === Address.toStandard(appConfig.get('Contracts.starknet.sway'), 'starknet')
      && selector === hash.getSelectorFromName('approve').toLowerCase()
    ) return;

    if (appConfig.get('Contracts.starknet.escrow')) {
      const escrowAddress = Address.toStandard(appConfig.get('Contracts.starknet.escrow'), 'starknet');
      const escrowSelectors = [
        'deposit',
        'withdraw',
        'start_force_withdraw',
        'finish_force_withdraw'
      ].map((entrypoint) => hash.getSelectorFromName(entrypoint).toLowerCase());

      if (contractAddress === escrowAddress && escrowSelectors.includes(selector)) return;
    }

    throw new ValidationError('Unsupported sponsored invoke call');
  }

  static async validateInvokeTransaction({ transaction, userAddress }) {
    if (!transaction.invoke?.user_address) throw new ValidationError('Invalid invoke transaction');
    this.validateUserAddress({ requestAddress: transaction.invoke.user_address, userAddress });
    const purchase = await this.validateStarterPackEligibility({
      recipient: transaction.invoke.user_address,
      sinceField: 'grantedAt',
      statuses: INVOKE_PURCHASE_STATUSES
    });

    const calls = transaction.invoke.calls || [];
    if (!Array.isArray(calls) || calls.length === 0) throw new ValidationError('Missing invoke calls');
    calls.forEach(this.validateAllowedInvokeCall);
    return purchase;
  }

  static async validateExecuteRequest({ body, transaction, userAddress }) {
    const preparedFingerprint = fingerprint(preparedPayloadForExecuteRequest(body));
    const sponsorship = await mongoose.model('PaymasterSponsorship').findOne({
      chainId: chainId(),
      createdAt: { $gte: reservationCutoff() },
      preparedFingerprint,
      status: 'reserved',
      userAddress: Address.toStandard(userAddress, 'starknet')
    }).populate('purchase');
    if (!sponsorship) throw new ValidationError('No matching paymaster sponsorship reservation');
    if (sponsorship.transactionType !== transaction?.type) {
      throw new ValidationError('Paymaster transaction type mismatch');
    }

    if (transaction.type === 'deploy') await this.validateAccountUndeployed(userAddress);
    return sponsorship.purchase;
  }

  static async reserveBudget({ body, purchase, response }) {
    if (!isBuildMethod(body.method) || !isSuccessfulResponse(response)) return;

    const { result } = response.data;
    const estimatedFeeFri = feeFriFromBuildResult(result);
    if (!estimatedFeeFri) throw new ValidationError('Missing paymaster fee estimate');

    const reservedMilliStrk = milliStrkFromFeeFri(estimatedFeeFri);
    if (reservedMilliStrk <= 0) throw new ValidationError('Invalid paymaster fee estimate');

    const purchaseModel = mongoose.model('StarterPackPurchase');
    const sponsorshipModel = mongoose.model('PaymasterSponsorship');
    const requestFingerprint = fingerprint({
      parameters: body.params.parameters,
      transaction: body.params.transaction
    });
    const preparedFingerprint = fingerprint(preparedPayloadForBuildResult(result));

    const existing = await sponsorshipModel.findOne({ requestFingerprint });
    if (existing) return;

    const updatedPurchase = await purchaseModel.findOneAndUpdate(
      {
        _id: purchase._id,
        paymasterReservedMilliStrk: { $lte: budgetMilliStrk() - reservedMilliStrk }
      },
      { $inc: { paymasterReservedMilliStrk: reservedMilliStrk } },
      { new: true }
    );
    if (!updatedPurchase) throw new ValidationError('Starter pack paymaster budget exceeded');

    try {
      await sponsorshipModel.create({
        chainId: chainId(),
        estimatedFeeFri: estimatedFeeFri.toString(),
        method: body.method,
        preparedFingerprint,
        purchase: purchase._id,
        requestFingerprint,
        reservedMilliStrk,
        transactionType: body.params.transaction.type,
        userAddress: body.params.transaction.deployment?.address || body.params.transaction.invoke?.user_address
      });
    } catch (error) {
      await purchaseModel.updateOne(
        { _id: purchase._id },
        { $inc: { paymasterReservedMilliStrk: -reservedMilliStrk } }
      );
      throw error;
    }
  }

  static async markSubmitted({ body, response, userAddress }) {
    if (!isExecuteMethod(body.method) || !isSuccessfulResponse(response)) return;

    await mongoose.model('PaymasterSponsorship').updateOne(
      {
        chainId: chainId(),
        preparedFingerprint: fingerprint(preparedPayloadForExecuteRequest(body)),
        status: 'reserved',
        userAddress: Address.toStandard(userAddress, 'starknet')
      },
      {
        $set: {
          status: 'submitted',
          txHash: response.data.result.transaction_hash
            || response.data.result.transactionHash
            || response.data.result
        }
      }
    );
  }

  static isConfigured() {
    return Boolean(appConfig.get('Avnu.paymasterUrl') && appConfig.get('Avnu.paymasterApiKey'));
  }

  static async forward({ body, userAddress }) {
    const purchase = await this.validateRequest({ body, userAddress });

    const response = await axios.post(appConfig.get('Avnu.paymasterUrl'), body, {
      headers: {
        'Content-Type': 'application/json',
        'x-paymaster-api-key': appConfig.get('Avnu.paymasterApiKey')
      },
      responseType: 'json',
      timeout: Number(appConfig.get('Avnu.requestTimeoutMs')),
      validateStatus: () => true
    });

    await this.reserveBudget({ body, purchase, response });
    await this.markSubmitted({ body, response, userAddress });
    return response;
  }
}

module.exports = AvnuPaymasterService;
