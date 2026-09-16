const { expect } = require('chai');
const { rejects } = require('node:assert/strict');
const sinon = require('sinon');
const client = require('@common/lib/starknet/client');
const { isContractNotDeployedError } = require('@common/lib/starknet/errors');
const erc20Abi = require('@common/lib/starknet/abis/erc20.json');

const { hash, uint256 } = client.starknet;
const nodeUrl = 'https://starknet.test';
const feeEstimate = {
  l1_gas_consumed: '0x2',
  l1_gas_price: '0x3',
  l1_data_gas_consumed: '0x4',
  l1_data_gas_price: '0x5',
  l2_gas_consumed: '0x6',
  l2_gas_price: '0x7',
  overall_fee: '0x44',
  unit: 'FRI'
};

const mockRpc = (overrides = {}) => {
  const responses = {
    starknet_specVersion: '0.10.4',
    starknet_chainId: '0x534e5f5345504f4c4941',
    starknet_getNonce: '0x7',
    starknet_getClassAt: { sierra_program: [], abi: '[]', contract_class_version: '0.1.0' },
    starknet_blockNumber: 100,
    starknet_getBlockWithTxs: {
      block_number: 100,
      transactions: Array.from({ length: 10 }, () => ({ type: 'INVOKE', version: '0x3', tip: '0x1' }))
    },
    starknet_estimateFee: [feeEstimate],
    starknet_addInvokeTransaction: { transaction_hash: '0xabc' },
    starknet_call: ['0x1'],
    ...overrides
  };
  const requests = [];
  const baseFetch = sinon.spy(async (url, options) => {
    expect(url).to.equal(nodeUrl);
    const request = JSON.parse(options.body);
    requests.push(request);
    if (!(request.method in responses)) throw new Error(`Unexpected RPC method: ${request.method}`);
    const value = responses[request.method];
    return { json: async () => ({ jsonrpc: '2.0', id: request.id, ...(value?.error ? value : { result: value }) }) };
  });
  return { baseFetch, requests };
};

describe('Starknet SDK client', function () {
  for (const specVersion of ['0.9.0', '0.10.2', '0.10.4']) {
    it(`should negotiate RPC ${specVersion} and serialize a signature verification call`, async function () {
      const { baseFetch, requests } = mockRpc({ starknet_specVersion: specVersion });
      const provider = await client.createRpcProvider({ nodeUrl, baseFetch });
      expect(provider.readSpecVersion()).to.equal(specVersion);
      expect(await provider.callContract({
        contractAddress: '0x123', entrypoint: 'is_valid_signature', calldata: ['0x456', '0x2', '0x1', '0x2']
      }, 'latest')).to.deep.equal(['0x1']);
      expect(requests.at(-1).params).to.deep.equal({
        block_id: 'latest',
        request: {
          contract_address: '0x123',
          entry_point_selector: hash.getSelectorFromName('is_valid_signature'),
          calldata: ['0x456', '0x2', '0x1', '0x2']
        }
      });
    });
  }

  it('should reject a missing endpoint and unsupported RPC 0.8', async function () {
    await rejects(client.createRpcProvider(), /endpoint is required/);
    const { baseFetch } = mockRpc({ starknet_specVersion: '0.8.1' });
    await rejects(client.createRpcProvider({ nodeUrl, baseFetch }), /0.8.1|unsupported|compatible/i);
  });

  for (const code of [20, 24, -32603]) {
    it(`should classify structured deployment lookup error ${code}`, async function () {
      const { baseFetch } = mockRpc({
        starknet_getClassAt: { error: { code, message: 'Contract not found' } }
      });
      const provider = await client.createRpcProvider({ nodeUrl, baseFetch });
      await rejects(provider.getClassAt('0x123', 'latest'), (error) => {
        expect(error).to.be.instanceOf(client.starknet.RpcError);
        expect(isContractNotDeployedError(error)).to.equal(code === 20);
        return true;
      });
    });
  }

  it('should not classify transport error text as an undeployed contract', function () {
    expect(isContractNotDeployedError(new Error('Contract not found'))).to.equal(false);
  });

  it('should not submit when fee estimation fails', async function () {
    const { baseFetch, requests } = mockRpc({
      starknet_estimateFee: { error: { code: 41, message: 'Transaction execution error' } }
    });
    const provider = await client.createRpcProvider({ nodeUrl, baseFetch });
    const account = client.createAccount({ provider, address: '0x123', signer: '0x456' });
    await rejects(account.execute({ contractAddress: '0x789', entrypoint: 'grant', calldata: [] }), /execution error/);
    expect(requests.some((request) => request.method === 'starknet_addInvokeTransaction')).to.equal(false);
  });

  for (const useContract of [false, true]) {
    it(`should estimate, sign and submit a v3 ${useContract ? 'faucet transfer' : 'account call'}`, async function () {
      const { baseFetch, requests } = mockRpc();
      const provider = await client.createRpcProvider({ nodeUrl, baseFetch });
      const account = client.createAccount({ provider, address: '0x123', signer: '0x456' });
      expect(account.provider).to.equal(provider);
      const contract = client.createContract({ abi: erc20Abi, address: '0x789', providerOrAccount: account });
      const response = useContract
        ? await contract.transfer('0x321', uint256.bnToUint256(400000000000n))
        : await account.execute({ contractAddress: '0x789', entrypoint: 'grant', calldata: ['0x321', '0x5'] });
      expect(response.transaction_hash).to.equal('0xabc');
      expect(requests.some((request) => request.method === 'starknet_estimateFee')).to.equal(true);
      const submissions = requests.filter((request) => request.method === 'starknet_addInvokeTransaction');
      expect(submissions).to.have.lengthOf(1);
      const tx = submissions[0].params.invoke_transaction;
      expect(tx).to.include({ sender_address: '0x123', version: '0x3', nonce: '0x7', type: 'INVOKE' });
      expect(tx.signature).to.have.lengthOf(2);
      expect(tx.signature.every((value) => BigInt(value) > 0n)).to.equal(true);
      expect(Object.keys(tx.resource_bounds)).to.have.members(['l1_gas', 'l1_data_gas', 'l2_gas']);
      expect(BigInt(tx.resource_bounds.l2_gas.max_amount) >= 6n).to.equal(true);
      const expected = useContract
        ? ['1', '0x789', hash.getSelectorFromName('transfer'), '3', '0x321', '400000000000', '0']
        : ['1', '0x789', hash.getSelectorFromName('grant'), '2', '0x321', '5'];
      expect(tx.calldata.map(BigInt)).to.deep.equal(expected.map(BigInt));
    });
  }
});
