const appConfig = require('config');
const { expect } = require('chai');
const mongoose = require('mongoose');
const moment = require('moment');
const { Address } = require('@influenceth/sdk');
const Handler = require('@common/lib/events/handlers/ethereum/IStarknetCore/LogMessageToL1');

describe('StarknetCore::LogMessageToL1 event handler', function () {
  afterEach(function () {
    return this.utils.resetCollections(['Crossing', 'SwayCrossing']);
  });

  describe('processEvent', function () {
    it('should update/create the corresponding crossing document', async function () {
      const eventDoc = mongoose.model('Ethereum')({
        event: 'LogMessageToL1',
        returnValues: {
          0: '2455808148850875413102822724988213798219361315872550608333318010400712693175',
          1: '0x55A30026e0896CFee359a5762BeA418D989b7682',
          2: [
            '1',
            '2455808148850875413102822724988213798219361315872550608333318010400712693175',
            '917476384115720854794616797117969392552273877743180770751417131002681153336',
            '429422743752437076584611397888315848149267139549',
            '212019'
          ],
          fromAddress: BigInt(Address.toStandard(appConfig.get('Contracts.starknet.asteroid'), 'starknet')).toString(),
          toAddress: Address.toStandard(appConfig.get('Contracts.ethereum.asteroidBridge'), 'ethereum'),
          payload: [
            '1',
            '2455808148850875413102822724988213798219361315872550608333318010400712693175',
            '917476384115720854794616797117969392552273877743180770751417131002681153336',
            '429422743752437076584611397888315848149267139549',
            '1',
            '2',
            '3'
          ]
        },
        timestamp: moment().unix()
      });

      const handler = new Handler(eventDoc);
      await handler.processEvent();

      const doc = await mongoose.model('Crossing').findOne({ assetIdsKey: 'Asteroid:1_2_3' });
      expect(doc).to.be.an('object');
      expect(doc.toJSON()).to.eql({
        id: doc.id,
        assetIdsKey: 'Asteroid:1_2_3',
        assetIds: [1, 2, 3],
        assetType: 'Asteroid',
        destination: 'ETHEREUM',
        destinationBridge: Address.toStandard(eventDoc.returnValues.toAddress, 'ethereum'),
        fromAddress: Address.toStandard(eventDoc.returnValues.payload[2], 'starknet'),
        origin: 'STARKNET',
        originBridge: Address.toStandard(eventDoc.returnValues.fromAddress, 'starknet'),
        status: 'PROCESSING',
        toAddress: Address.toStandard(eventDoc.returnValues.payload[3], 'ethereum'),
        event: {
          id: eventDoc._id,
          timestamp: eventDoc.timestamp
        }
      });
    });

    it('should increment the ready count for the corresponding SwayCrossing document', async function () {
      const eventDoc = mongoose.model('Ethereum')({
        event: 'LogMessageToL1',
        transactionHash: '0x8005c88f780b2a3a5087dc5187aec841a117cf77b133e992e69bd72da69eb03e',
        logIndex: 1,
        returnValues: {
          0: BigInt(appConfig.get('Contracts.starknet.sway')).toString(),
          1: appConfig.get('Contracts.ethereum.swayBridge'),
          2: [
            '1',
            '0xE88210749F561CCB7839593E99b00414699a80DD',
            '0x1e240',
            '0x0'
          ],
          fromAddress: BigInt(appConfig.get('Contracts.starknet.sway')).toString(),
          toAddress: Address.toStandard(appConfig.get('Contracts.ethereum.swayBridge'), 'ethereum'),
          payload: [
            '1',
            '0xE88210749F561CCB7839593E99b00414699a80DD',
            '0x1e240',
            '0x0'
          ]
        },
        timestamp: moment().unix()
      });

      await mongoose.model('SwayCrossing').create({
        amount: '0x1e240',
        toAddress: '0xE88210749F561CCB7839593E99b00414699a80DD',
        readyCount: 0,
        events: [
          {
            transactionHash: '0x123456789',
            logIndex: 1,
            timestamp: moment().unix()
          }
        ]
      });

      const handler = new Handler(eventDoc);
      await handler.processEvent();

      const doc = await mongoose.model('SwayCrossing').findOne();
      expect(doc.readyCount).to.equal(1);
      expect(doc.events.length).to.equal(2);
    });
  });
});
