const { expect } = require('chai');
const axios = require('axios');
const appConfig = require('config');
const mongoose = require('mongoose');
const { hash } = require('starknet');
const { Address } = require('@influenceth/sdk');
const starknetClient = require('@common/lib/starknet/client');
const { AvnuPaymasterService } = require('@common/services');

const USER_ADDRESS = Address.toStandard('0x123', 'starknet');
const READY_CLASS_HASH = '0x073414441639dcd11d1846f287650a00c60c416b9d3ba45d31c651672125b2c2';

const readyDeployTransaction = ({ address = USER_ADDRESS, publicKey = '0x789' } = {}) => ({
  deployment: {
    address,
    calldata: ['0x0', publicKey, '0x1'],
    class_hash: READY_CLASS_HASH,
    salt: publicKey,
    version: 1
  },
  type: 'deploy'
});

const allowedDispatcherCall = () => ({
  calldata: [],
  contract_address: appConfig.get('Contracts.starknet.dispatcher'),
  entry_point_selector: hash.getSelectorFromName('run_system')
});

const buildResponse = (overrides = {}) => ({
  data: {
    id: 1,
    jsonrpc: '2.0',
    result: {
      fee: {
        estimated_fee_in_gas_token: '0x1',
        estimated_fee_in_strk: '0x1',
        gas_token_price_in_strk: '0x1',
        suggested_max_fee_in_gas_token: '0x1',
        suggested_max_fee_in_strk: '0x38d7ea4c68000'
      },
      parameters: { fee_mode: { mode: 'sponsored' }, version: '0x1' },
      type: 'invoke',
      ...overrides
    }
  },
  status: 200
});

const expectReject = async (promise, message) => {
  try {
    await promise;
  } catch (error) {
    expect(error.message).to.equal(message);
    return;
  }
  throw new Error(`Expected rejection: ${message}`);
};

const paymasterRequest = (overrides = {}) => ({
  id: 1,
  jsonrpc: '2.0',
  method: 'paymaster_buildTransaction',
  params: {
    parameters: {
      fee_mode: { mode: 'sponsored' },
      version: '0x1'
    },
    transaction: {
      invoke: {
        calls: [allowedDispatcherCall()],
        user_address: USER_ADDRESS
      },
      type: 'invoke'
    }
  },
  ...overrides
});

describe('AvnuPaymasterService', function () {
  beforeEach(async function () {
    appConfig.Contracts.starknet.escrow = '0x789';
    appConfig.Avnu.paymasterMaxStarterPackBudgetStrk = 100;
    await this.utils.resetCollections(['PaymasterSponsorship', 'StarterPackPurchase']);
  });

  const createPurchase = (overrides = {}) => mongoose.model('StarterPackPurchase').create({
    chainId: appConfig.get('Starknet.chainId').toString(),
    grantedAt: new Date(),
    paidAt: new Date(),
    productId: 1,
    purchaser: USER_ADDRESS,
    recipient: USER_ADDRESS,
    status: 'grant_confirmed',
    stripePriceId: 'price_123',
    stripeProductId: 'prod_123',
    ...overrides
  });

  it('should forward a sponsored request with the server-side API key', async function () {
    const body = paymasterRequest();
    const response = buildResponse({
      type: 'invoke',
      typed_data: { message: 'typed data' }
    });
    const postStub = this._sandbox.stub(axios, 'post').resolves(response);
    await createPurchase();

    const result = await AvnuPaymasterService.forward({ body, userAddress: USER_ADDRESS });

    expect(result).to.equal(response);
    expect(postStub.calledOnce).to.equal(true);
    expect(postStub.firstCall.args[0]).to.equal('https://paymaster.localhost');
    expect(postStub.firstCall.args[1]).to.equal(body);
    expect(postStub.firstCall.args[2].headers['x-paymaster-api-key']).to.equal(
      appConfig.get('Avnu.paymasterApiKey')
    );
    const sponsorship = await mongoose.model('PaymasterSponsorship').findOne().lean();
    const purchase = await mongoose.model('StarterPackPurchase').findOne().lean();
    expect(sponsorship.reservedMilliStrk).to.equal(1);
    expect(purchase.paymasterReservedMilliStrk).to.equal(1);
  });

  it('should reject unsupported methods', async function () {
    await expectReject(AvnuPaymasterService.validateRequest({
      body: paymasterRequest({ method: 'paymaster_adminMethod' }),
      userAddress: USER_ADDRESS
    }), 'Invalid paymaster request');
  });

  it('should reject non-sponsored transactions', async function () {
    const body = paymasterRequest();
    body.params.parameters.fee_mode.mode = 'default';

    await expectReject(
      AvnuPaymasterService.validateRequest({ body, userAddress: USER_ADDRESS }),
      'Only sponsored paymaster transactions are supported'
    );
  });

  it('should reject transactions for a different user', async function () {
    await expectReject(AvnuPaymasterService.validateRequest({
      body: paymasterRequest(),
      userAddress: '0x456'
    }), 'Paymaster user address does not match authenticated user');
  });

  it('should allow dispatcher, sway, and escrow multicalls for confirmed starter pack purchasers', async function () {
    await createPurchase();
    const body = paymasterRequest();
    body.params.transaction.invoke.calls = [
      {
        calldata: [],
        contract_address: appConfig.get('Contracts.starknet.dispatcher'),
        entry_point_selector: hash.getSelectorFromName('run_system')
      },
      {
        calldata: ['0x1', '0x0'],
        contract_address: appConfig.get('Contracts.starknet.sway'),
        entry_point_selector: '0x0a72371689866be053cc37a071de4216af73c9ffff96319b2576f7bf1e15290'
      },
      {
        calldata: ['0x1', '0x0'],
        contract_address: appConfig.get('Contracts.starknet.sway'),
        entry_point_selector: 'approve'
      },
      {
        calldata: [],
        contract_address: appConfig.get('Contracts.starknet.escrow'),
        entry_point_selector: 'deposit'
      },
      {
        calldata: [],
        contract_address: appConfig.get('Contracts.starknet.escrow'),
        entry_point_selector: 'withdraw'
      },
      {
        calldata: [],
        contract_address: appConfig.get('Contracts.starknet.escrow'),
        entry_point_selector: 'start_force_withdraw'
      },
      {
        calldata: [],
        contract_address: appConfig.get('Contracts.starknet.escrow'),
        entry_point_selector: 'finish_force_withdraw'
      }
    ];

    await AvnuPaymasterService.validateRequest({ body, userAddress: USER_ADDRESS });
  });

  it('should reject invoke sponsorship without a recent confirmed starter pack purchase', async function () {
    await createPurchase({ grantedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000) });

    await expectReject(AvnuPaymasterService.validateRequest({
      body: paymasterRequest(),
      userAddress: USER_ADDRESS
    }), 'No eligible starter pack purchase for paymaster sponsorship');
  });

  it('should reject unsupported invoke calls', async function () {
    await createPurchase();
    const body = paymasterRequest();
    body.params.transaction.invoke.calls = [
      {
        calldata: [],
        contract_address: appConfig.get('Contracts.starknet.crew'),
        entry_point_selector: hash.getSelectorFromName('approve')
      }
    ];

    await expectReject(
      AvnuPaymasterService.validateRequest({ body, userAddress: USER_ADDRESS }),
      'Unsupported sponsored invoke call'
    );
  });

  it('should allow Ready deploys for paid starter pack purchasers with undeployed accounts', async function () {
    const transaction = readyDeployTransaction({ publicKey: '0x789' });
    transaction.deployment.address = hash.calculateContractAddressFromHash(
      transaction.deployment.salt,
      transaction.deployment.class_hash,
      transaction.deployment.calldata,
      0
    );
    await createPurchase({
      recipient: transaction.deployment.address,
      status: 'paid_pending_customization'
    });
    this._sandbox.stub(starknetClient, 'createRpcProvider').resolves({
      getClassAt: this._sandbox.stub().rejects(new Error('Requested contract address is not deployed'))
    });

    await AvnuPaymasterService.validateRequest({
      body: paymasterRequest({
        params: {
          parameters: { fee_mode: { mode: 'sponsored' }, version: '0x1' },
          transaction
        }
      }),
      userAddress: transaction.deployment.address
    });
  });

  it('should reject Ready deploys whose address does not match their constructor data', async function () {
    const transaction = readyDeployTransaction();
    await createPurchase({ status: 'paid_pending_customization' });
    this._sandbox.stub(starknetClient, 'createRpcProvider').resolves({
      getClassAt: this._sandbox.stub().rejects(new Error('Requested contract address is not deployed'))
    });

    await expectReject(AvnuPaymasterService.validateRequest({
      body: paymasterRequest({
        params: {
          parameters: { fee_mode: { mode: 'sponsored' }, version: '0x1' },
          transaction
        }
      }),
      userAddress: USER_ADDRESS
    }), 'Account deployment address mismatch');
  });

  it('should reject deploy sponsorship for deployed accounts', async function () {
    const transaction = readyDeployTransaction({ publicKey: '0x789' });
    transaction.deployment.address = hash.calculateContractAddressFromHash(
      transaction.deployment.salt,
      transaction.deployment.class_hash,
      transaction.deployment.calldata,
      0
    );
    await createPurchase({
      recipient: transaction.deployment.address,
      status: 'paid_pending_customization'
    });
    this._sandbox.stub(starknetClient, 'createRpcProvider').resolves({
      getClassAt: this._sandbox.stub().resolves({})
    });

    await expectReject(AvnuPaymasterService.validateRequest({
      body: paymasterRequest({
        params: {
          parameters: { fee_mode: { mode: 'sponsored' }, version: '0x1' },
          transaction
        }
      }),
      userAddress: transaction.deployment.address
    }), 'Account is already deployed');
  });

  it('should reject builds that exceed the starter pack paymaster budget', async function () {
    appConfig.Avnu.paymasterMaxStarterPackBudgetStrk = 1;
    const body = paymasterRequest();
    const response = buildResponse({
      fee: {
        estimated_fee_in_gas_token: '0x1',
        estimated_fee_in_strk: '0x1',
        gas_token_price_in_strk: '0x1',
        suggested_max_fee_in_gas_token: '0x1',
        suggested_max_fee_in_strk: '0xde0b6b3a7640001'
      }
    });
    this._sandbox.stub(axios, 'post').resolves(response);
    await createPurchase();

    await expectReject(
      AvnuPaymasterService.forward({ body, userAddress: USER_ADDRESS }),
      'Starter pack paymaster budget exceeded'
    );
  });

  it('should reject execute requests without a matching reservation', async function () {
    await expectReject(AvnuPaymasterService.validateRequest({
      body: paymasterRequest({ method: 'paymaster_executeTransaction' }),
      userAddress: USER_ADDRESS
    }), 'No matching paymaster sponsorship reservation');
  });

  it('should mark matching execute reservations submitted', async function () {
    const body = paymasterRequest();
    const result = {
      fee: {
        estimated_fee_in_gas_token: '0x1',
        estimated_fee_in_strk: '0x1',
        gas_token_price_in_strk: '0x1',
        suggested_max_fee_in_gas_token: '0x1',
        suggested_max_fee_in_strk: '0x38d7ea4c68000'
      },
      parameters: body.params.parameters,
      type: 'invoke',
      typed_data: { message: 'typed data' }
    };
    const executeBody = paymasterRequest({
      method: 'paymaster_executeTransaction',
      params: {
        parameters: body.params.parameters,
        transaction: {
          parameters: body.params.parameters,
          type: 'invoke',
          typed_data: { message: 'typed data' }
        }
      }
    });
    const postStub = this._sandbox.stub(axios, 'post');
    postStub.onFirstCall().resolves({ data: { id: 1, jsonrpc: '2.0', result }, status: 200 });
    postStub.onSecondCall().resolves({
      data: { id: 1, jsonrpc: '2.0', result: { transaction_hash: '0xtx' } },
      status: 200
    });
    await createPurchase();

    await AvnuPaymasterService.forward({ body, userAddress: USER_ADDRESS });
    await AvnuPaymasterService.forward({ body: executeBody, userAddress: USER_ADDRESS });

    const sponsorship = await mongoose.model('PaymasterSponsorship').findOne().lean();
    expect(sponsorship.status).to.equal('submitted');
    expect(sponsorship.txHash).to.equal('0xtx');
  });

  it('should match invoke execute requests after AVNU converts calls to typed data', async function () {
    const body = paymasterRequest({
      params: {
        parameters: { fee_mode: { mode: 'sponsored' }, version: '0x1' },
        transaction: {
          invoke: {
            calls: [
              {
                calldata: ['0x4163636570745072657061696441677265656d656e74', '0x8'],
                selector: hash.getSelectorFromName('run_system'),
                to: `0x0${Address.toStandard(appConfig.get('Contracts.starknet.dispatcher'), 'starknet').slice(2)}`
              }
            ],
            user_address: USER_ADDRESS
          },
          type: 'invoke'
        }
      }
    });
    const typedData = {
      domain: {
        chainId: 'SN_SEPOLIA',
        name: 'Account.execute_from_outside',
        revision: '1',
        version: '2'
      },
      message: {
        Calls: [
          {
            Calldata: ['0x4163636570745072657061696441677265656d656e74', '0x8'],
            Selector: hash.getSelectorFromName('run_system'),
            To: Address.toStandard(appConfig.get('Contracts.starknet.dispatcher'), 'starknet')
          }
        ],
        Caller: '0x75a180e18e56da1b1cae181c92a288f586f5fe22c18df21cf97886f1e4b316c',
        'Execute After': '0x1',
        'Execute Before': '0x6a9587e7',
        Nonce: '0xbee2b5ac6c92f993dc479e76ea991129'
      },
      primaryType: 'OutsideExecution',
      types: {}
    };
    const executeBody = paymasterRequest({
      method: 'paymaster_executeTransaction',
      params: {
        parameters: { fee_mode: { mode: 'sponsored' }, version: '0x1' },
        transaction: {
          invoke: {
            signature: ['0x1', '0x2'],
            typed_data: typedData,
            user_address: USER_ADDRESS
          },
          type: 'invoke'
        }
      }
    });
    const postStub = this._sandbox.stub(axios, 'post');
    postStub.onFirstCall().resolves({
      data: {
        id: 5,
        jsonrpc: '2.0',
        result: buildResponse({
          parameters: {
            fee_mode: { mode: 'sponsored', tip: 'normal' },
            time_bounds: null,
            version: '0x1'
          },
          typed_data: typedData,
          type: 'invoke'
        }).data.result
      },
      status: 200
    });
    postStub.onSecondCall().resolves({
      data: { id: 6, jsonrpc: '2.0', result: { transaction_hash: '0xinvoketx' } },
      status: 200
    });
    await createPurchase();

    await AvnuPaymasterService.forward({ body, userAddress: USER_ADDRESS });
    await AvnuPaymasterService.forward({ body: executeBody, userAddress: USER_ADDRESS });

    const sponsorship = await mongoose.model('PaymasterSponsorship').findOne().lean();
    expect(sponsorship.status).to.equal('submitted');
    expect(sponsorship.txHash).to.equal('0xinvoketx');
  });

  it('should match deploy execute requests when AVNU normalizes felts and omits tip', async function () {
    const publicKey = '0x5d880ad7abc2e3eb9080a10a2b1d60732b2e002364d5f90449a8e5438962c96';
    const transaction = readyDeployTransaction({ publicKey });
    transaction.deployment.address = hash.calculateContractAddressFromHash(
      transaction.deployment.salt,
      transaction.deployment.class_hash,
      transaction.deployment.calldata,
      0
    );
    await createPurchase({
      recipient: transaction.deployment.address,
      status: 'paid_pending_customization'
    });
    this._sandbox.stub(starknetClient, 'createRpcProvider').resolves({
      getClassAt: this._sandbox.stub().rejects(new Error('Requested contract address is not deployed'))
    });

    const body = paymasterRequest({
      params: {
        parameters: { fee_mode: { mode: 'sponsored' }, version: '0x1' },
        transaction
      }
    });
    const preparedDeploy = {
      deployment: {
        ...transaction.deployment,
        class_hash: Address.toStandard(transaction.deployment.class_hash, 'starknet'),
        sigdata: null
      },
      fee: {
        estimated_fee_in_gas_token: '0x1',
        estimated_fee_in_strk: '0x1',
        gas_token_price_in_strk: '0x1',
        suggested_max_fee_in_gas_token: '0x1',
        suggested_max_fee_in_strk: '0x38d7ea4c68000'
      },
      parameters: {
        fee_mode: { mode: 'sponsored', tip: 'normal' },
        time_bounds: null,
        version: '0x1'
      },
      type: 'deploy'
    };
    const executeBody = paymasterRequest({
      method: 'paymaster_executeTransaction',
      params: {
        parameters: { fee_mode: { mode: 'sponsored' }, version: '0x1' },
        transaction: {
          deployment: preparedDeploy.deployment,
          type: 'deploy'
        }
      }
    });
    const postStub = this._sandbox.stub(axios, 'post');
    postStub.onFirstCall().resolves({ data: { id: 1, jsonrpc: '2.0', result: preparedDeploy }, status: 200 });
    postStub.onSecondCall().resolves({
      data: { id: 2, jsonrpc: '2.0', result: { transaction_hash: '0xdeploytx' } },
      status: 200
    });

    await AvnuPaymasterService.forward({ body, userAddress: transaction.deployment.address });
    await AvnuPaymasterService.forward({ body: executeBody, userAddress: transaction.deployment.address });

    const sponsorship = await mongoose.model('PaymasterSponsorship').findOne().lean();
    expect(sponsorship.status).to.equal('submitted');
    expect(sponsorship.txHash).to.equal('0xdeploytx');
  });
});
