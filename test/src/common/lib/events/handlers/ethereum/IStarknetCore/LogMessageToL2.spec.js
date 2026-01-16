const appConfig = require('config');
const { expect } = require('chai');
const mongoose = require('mongoose');
const moment = require('moment');
const { Address } = require('@influenceth/sdk');
const Handler = require('@common/lib/events/handlers/ethereum/IStarknetCore/LogMessageToL2');

describe('StarknetCore::LogMessageToL2 event handler', function () {
  afterEach(function () {
    return this.utils.resetCollections('Crossing');
  });

  describe('processEvent', function () {
    it('should update/create the corresponding crossing document for a bridged Asteroid', async function () {
      const eventDoc = mongoose.model('Ethereum')({
        event: 'LogMessageToL2',
        returnValues: {
          fromAddress: Address.toStandard(appConfig.get('Contracts.ethereum.asteroidBridge'), 'ethereum'),
          toAddress: BigInt(Address.toStandard(appConfig.get('Contracts.starknet.asteroid'), 'starknet')).toString(),
          selector: '1157548185917827836691019656633924546219803202764187478285065005547416801023',
          payload: [
            '917476384115720854794616797117969392552273877743180770751417131002681153336',
            '2',
            '1',
            '2'
          ],
          nonce: '776746',
          fee: '22335000335025'
        },
        timestamp: moment().unix()
      });

      const handler = new Handler(eventDoc);
      await handler.processEvent();

      const doc = await mongoose.model('Crossing').findOne({ assetIdsKey: 'Asteroid:1_2' });
      expect(doc).to.be.an('object');
      expect(doc.toJSON()).to.eql({
        id: doc.id,
        assetIdsKey: 'Asteroid:1_2',
        assetIds: [1, 2],
        assetType: 'Asteroid',
        destination: 'STARKNET',
        destinationBridge: Address.toStandard(eventDoc.returnValues.toAddress, 'starknet'),
        origin: 'ETHEREUM',
        originBridge: Address.toStandard(eventDoc.returnValues.fromAddress, 'ethereum'),
        status: 'PROCESSING',
        toAddress: Address.toStandard(eventDoc.returnValues.payload[0], 'starknet'),
        event: {
          id: eventDoc._id,
          timestamp: eventDoc.timestamp
        }
      });
    });

    it('should update/create the corresponding crossing document for a bridged Crewmate', async function () {
      const eventDoc = mongoose.model('Ethereum')({
        event: 'LogMessageToL2',
        returnValues: {
          fromAddress: Address.toStandard(appConfig.get('Contracts.ethereum.crewmateBridge'), 'ethereum'),
          toAddress: BigInt(Address.toStandard(appConfig.get('Contracts.starknet.crewmate'), 'starknet')).toString(),
          selector: '1157548185917827836691019656633924546219803202764187478285065005547416801023',
          payload: [
            '917476384115720854794616797117969392552273877743180770751417131002681153336',
            '4',
            '1',
            '123123123123',
            '2',
            '123123123123'
          ],
          nonce: '776746',
          fee: '22335000335025'
        },
        timestamp: moment().unix()
      });

      const handler = new Handler(eventDoc);
      await handler.processEvent();

      const doc = await mongoose.model('Crossing').findOne({ assetIdsKey: 'Crewmate:1_2' });
      expect(doc).to.be.an('object');
      expect(doc.toJSON()).to.eql({
        id: doc.id,
        assetIdsKey: 'Crewmate:1_2',
        assetIds: [1, 2],
        assetType: 'Crewmate',
        destination: 'STARKNET',
        destinationBridge: Address.toStandard(appConfig.get('Contracts.starknet.crewmate'), 'starknet'),
        origin: 'ETHEREUM',
        originBridge: Address.toStandard(appConfig.get('Contracts.ethereum.crewmateBridge'), 'ethereum'),
        status: 'PROCESSING',
        toAddress: Address.toStandard(eventDoc.returnValues.payload[0], 'starknet'),
        event: {
          id: eventDoc._id,
          timestamp: eventDoc.timestamp
        }
      });
    });
  });
});
