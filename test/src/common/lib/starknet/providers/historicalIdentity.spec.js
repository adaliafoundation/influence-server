const { expect } = require('chai');
const axios = require('axios');
const sinon = require('sinon');
const { Address } = require('@influenceth/sdk');
const BaseAuditor = require('@common/lib/events/auditors/Base');
const Block = require('@common/lib/starknet/models/Block');
const { RpcProvider } = require('@common/lib/starknet/providers');
const blockResponse = require('./mock_data/starknet_getBlockWithTxHashes.json');
const receiptResponse = require('./mock_data/starknet_getTransactionReceipt.json');
const eventsResponse = require('./mock_data/starknet_getEvents.json');

const historicalEvents = eventsResponse.result.events;
const receipt = receiptResponse.result;
const block = new Block(blockResponse.result);
const trackedAddress = historicalEvents[0].from_address;
const transactionIndex = 11;
// Receipt positions, including gaps occupied by other contracts' events.
const canonicalIndices = [0, 1, 2, 3, 5, 6, 7, 8, 10, 11, 13, 14, 16, 17, 19, 20, 22, 23, 24, 25, 26, 27, 28, 29];

const rpc010Events = receipt.events.map((event, eventIndex) => ({
  ...event,
  block_hash: receipt.block_hash,
  block_number: receipt.block_number,
  transaction_hash: receipt.transaction_hash,
  transaction_index: transactionIndex,
  event_index: eventIndex
}));

const fromAddress = (event, address) => BigInt(event.from_address) === BigInt(address);
const trackedRpc010Events = rpc010Events.filter((event) => fromAddress(event, trackedAddress));

// Use the selector keys as the event type to isolate RPC normalization from ABI parsing.
const auditEvents = (events) => events.map((event) => ({ ...event, event: event.keys.join(':') }));
const identities = (events) => auditEvents(events).map(BaseAuditor.getStableEventKey);
const payload = (event) => ({ address: event.from_address, keys: event.keys, data: event.data });

describe('Starknet historical event identities', function () {
  let sandbox;
  let provider;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    provider = new RpcProvider({ endpoint: 'https://starknet.test' });
    sandbox.stub(provider, '_getBlockWithTxHashes').resolves(block);
  });

  afterEach(function () {
    sandbox.restore();
  });

  const fetchTrackedEvents = (rpcProvider) => rpcProvider.getEvents({
    address: trackedAddress,
    fromBlock: block.blockNumber,
    toBlock: block.blockNumber
  }, { withBackOff: false });

  it('should preserve full-receipt identities in RPC 0.10, including repeated identical events', async function () {
    expect(block.getTransactionIndex(receipt.transaction_hash)).to.equal(transactionIndex);
    expect(trackedRpc010Events.map((event) => event.event_index)).to.deep.equal(canonicalIndices);
    expect(trackedRpc010Events.map(payload)).to.deep.equal(historicalEvents.map(payload));

    sandbox.stub(axios, 'post').resolves({ data: { result: { events: trackedRpc010Events } } });
    const events = await fetchTrackedEvents(provider);

    expect(events.map((event) => event.logIndex)).to.deep.equal(canonicalIndices);
    expect(events.map((event) => event.transactionIndex)).to.deep.equal(Array(24).fill(transactionIndex));
    expect(new Set(identities(events)).size).to.equal(24);
    // These identical payloads are separate emissions at different receipt positions.
    expect(events[5].data).to.deep.equal(events[20].data);
    expect(events[5].keys).to.deep.equal(events[20].keys);
    expect(identities(events)[5]).not.to.equal(identities(events)[20]);
  });

  it('should expose historical identity drift instead of treating it as metadata-only', async function () {
    const post = sandbox.stub(axios, 'post');
    post.onFirstCall().resolves({ data: eventsResponse });
    post.onSecondCall().resolves({ data: { result: { events: trackedRpc010Events } } });
    const legacy = await fetchTrackedEvents(provider);
    const canonical = await fetchTrackedEvents(provider);

    expect(legacy.map((event) => event.logIndex)).to.deep.equal(Array.from({ length: 24 }, (_, index) => index));
    const legacyIdentities = identities(legacy);
    const canonicalIdentities = identities(canonical);
    expect(canonicalIdentities.filter((identity, index) => identity !== legacyIdentities[index])).to.have.lengthOf(20);
    expect(BaseAuditor.compareBlockEvents({
      storedEvents: auditEvents(legacy),
      chainEvents: auditEvents(canonical)
    })).to.deep.equal({ identityChanged: true, metadataChanged: false });
  });

  it('should retain identities where legacy and receipt indices agree', async function () {
    const post = sandbox.stub(axios, 'post');
    post.onFirstCall().resolves({ data: { result: { events: historicalEvents.slice(0, 4) } } });
    post.onSecondCall().resolves({ data: { result: { events: trackedRpc010Events.slice(0, 4) } } });
    const legacy = await fetchTrackedEvents(provider);
    const canonical = await fetchTrackedEvents(provider);

    expect(identities(canonical)).to.deep.equal(identities(legacy));
    expect(BaseAuditor.compareBlockEvents({
      storedEvents: auditEvents(legacy),
      chainEvents: auditEvents(canonical)
    })).to.deep.equal({ identityChanged: false, metadataChanged: false });
  });

  it('should retain canonical identities across pagination and reversed batch responses', async function () {
    const addresses = [...new Set(receipt.events.map((event) => event.from_address))];
    expect(addresses.length).to.be.greaterThan(1);
    const continuationAddresses = [];
    sandbox.stub(axios, 'post').callsFake(async (endpoint, body) => {
      const page = (request) => {
        expect(request.method).to.equal('starknet_getEvents');
        const { address, continuation_token: token } = request.params.filter;
        const events = rpc010Events.filter((event) => fromAddress(event, address));
        if (token) {
          expect(token).to.equal(`page:${address}`);
          continuationAddresses.push(address);
          return { id: request.id, result: { events: events.slice(1) } };
        }
        return {
          id: request.id,
          result: {
            events: events.slice(0, 1),
            ...(events.length > 1 ? { continuation_token: `page:${address}` } : {})
          }
        };
      };
      return { data: Array.isArray(body) ? body.map(page).reverse() : page(body) };
    });

    const events = await provider.getEvents({
      addresses,
      fromBlock: block.blockNumber,
      toBlock: block.blockNumber
    }, { withBackOff: false });

    expect(continuationAddresses).to.include(Address.toStandard(trackedAddress, 'starknet'));
    expect(events).to.have.lengthOf(receipt.events.length);
    expect(new Set(identities(events)).size).to.equal(receipt.events.length);
    const ordered = [...events].sort((a, b) => a.logIndex - b.logIndex);
    expect(ordered.map((event) => event.logIndex)).to.deep.equal(Array.from({ length: 31 }, (_, index) => index));
    ordered.forEach((event, index) => {
      expect(event.address).to.equal(Address.toStandard(receipt.events[index].from_address, 'starknet'));
      expect(event.data).to.deep.equal(receipt.events[index].data);
      expect(event.keys).to.deep.equal(receipt.events[index].keys);
      expect(event.transactionIndex).to.equal(transactionIndex);
    });
  });
});
