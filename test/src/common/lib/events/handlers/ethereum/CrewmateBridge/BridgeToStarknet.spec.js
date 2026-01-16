const { expect } = require('chai');
const { Address } = require('@influenceth/sdk');
const appConfig = require('config');
const mongoose = require('mongoose');
const Handler = require('@common/lib/events/handlers/ethereum/CrewmateBridge/BridgeToStarknet');

describe('CrewmateBridge::BridgeToStarknet Handler', function () {
  let event;

  before(function () {
    event = mongoose.model('Ethereum')({
      event: 'BridgeToStarknet',
      logIndex: 1,
      timestamp: 1695691834,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      returnValues: {
        l1Contract: appConfig.get('Contracts.ethereum.asteroidBridge'),
        l1Account: '0x4B37Fb577D2e89812594bEE3A0124D7448084BDd',
        l2Account: '917476384115720854794616797117969392552273877743180770751417131002681153336',
        tokenId: '1'
      }
    });
  });

  afterEach(function () {
    return this.utils.resetCollections(['Activity', 'Crossing', 'Entity', 'Event', 'IndexItem', 'NftComponent']);
  });

  describe('processEvent', function () {
    let handler;

    beforeEach(async function () {
      await mongoose.model('Crossing').create({
        assetIds: [1],
        assetIdsKey: 'Crewmate:1',
        assetType: 'Crewmate',
        destination: 'STARKNET',
        destinationBridge: '0x1',
        fromAddress: null,
        origin: 'ETHEREUM',
        originBridge: '0x1',
        status: 'PROCESSING'
      });

      handler = new Handler(event);
    });

    it('should create a NftComponent document (if not found)', async function () {
      await handler.processEvent();
      const doc = await mongoose.model('NftComponent').findOne({ entity: { id: 1, label: 2 } });
      expect(doc).to.be.an('object');
      expect(doc.owners.starknet).to.equal(Address.toStandard(event.returnValues.l2Account, 'starknet'));
      expect(doc.bridge).to.deep.include({ destination: 'STARKNET', origin: 'ETHEREUM', status: 'PROCESSING' });
    });

    it('should update the NftComponent document, if current event is newer', async function () {
      await handler.processEvent();

      // bump the timestamp to simulate a newer event
      handler.eventDoc.timestamp = event.timestamp + 1;
      await handler.processEvent();

      const nftCompDoc = await mongoose.model('NftComponent').findOne({ entity: { id: 1, label: 2 } });
      expect(nftCompDoc).to.be.an('object');
      expect(nftCompDoc.event.timestamp).to.equal(event.timestamp);
    });

    it('should create an acitivity document', async function () {
      await handler.processEvent();
      const acitivityDoc = await mongoose.model('Activity').findOne({ 'event._id': event._id });
      expect(acitivityDoc).to.be.an('object');
    });

    it('should flag the entity for indexing', async function () {
      await handler.processEvent();
      const doc = await mongoose.model('IndexItem').findOne({
        model: 'Entity', identifier: { uuid: '0x10002' }
      });
      expect(doc).to.be.an('object');
    });
  });
});
