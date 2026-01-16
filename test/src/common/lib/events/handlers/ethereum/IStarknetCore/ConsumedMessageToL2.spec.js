const appConfig = require('config');
const { expect } = require('chai');
const mongoose = require('mongoose');
const moment = require('moment');
const { Address } = require('@influenceth/sdk');
const Handler = require('@common/lib/events/handlers/ethereum/IStarknetCore/ConsumedMessageToL2');

describe('StarknetCore::ConsumedMessageToL2 event handler', function () {
  afterEach(function () {
    return this.utils.resetCollections('Crossing');
  });

  describe('processEvent', function () {
    it('should remove the corresponding crossing document for a bridged Asteroid', async function () {
      const eventDoc = mongoose.model('Ethereum')({
        event: 'ConsumedMessageToL2',
        returnValues: {
          0: '0x55A30026e0896CFee359a5762BeA418D989b7682',
          1: '2455808148850875413102822724988213798219361315872550608333318010400712693175',
          2: '1157548185917827836691019656633924546219803202764187478285065005547416801023',
          3: [
            '917476384115720854794616797117969392552273877743180770751417131002681153336',
            '1',
            '212019'
          ],
          4: '776746',
          fromAddress: Address.toStandard(appConfig.get('Contracts.ethereum.asteroidBridge'), 'ethereum'),
          toAddress: Address.toStandard(appConfig.get('Contracts.starknet.asteroid'), 'starknet'),
          selector: '1157548185917827836691019656633924546219803202764187478285065005547416801023',
          payload: [
            '917476384115720854794616797117969392552273877743180770751417131002681153336',
            '1',
            '100'
          ],
          nonce: '776746'
        },
        timestamp: moment().unix()
      });

      const handler = new Handler(eventDoc);
      await handler.processEvent();

      const doc = await mongoose.model('Crossing').findOne({ assetIdsKey: 'Asteroid:100' });

      expect(doc).to.eql(null);
    });

    it('should remove the corresponding crossing document for a bridged Crewmate', async function () {
      const eventDoc = mongoose.model('Ethereum')({
        event: 'ConsumedMessageToL2',
        returnValues: {
          0: '0x55A30026e0896CFee359a5762BeA418D989b7682',
          1: '2455808148850875413102822724988213798219361315872550608333318010400712693175',
          2: '1157548185917827836691019656633924546219803202764187478285065005547416801023',
          3: [
            '917476384115720854794616797117969392552273877743180770751417131002681153336',
            '4',
            '100',
            '123123123',
            '200',
            '123123123'
          ],
          4: '776746',
          fromAddress: Address.toStandard(appConfig.get('Contracts.ethereum.crewmateBridge'), 'ethereum'),
          toAddress: Address.toStandard(appConfig.get('Contracts.starknet.crewmate'), 'starknet'),
          selector: '1157548185917827836691019656633924546219803202764187478285065005547416801023',
          payload: [
            '917476384115720854794616797117969392552273877743180770751417131002681153336',
            '4',
            '100',
            '123123123',
            '200',
            '123123123'
          ],
          nonce: '776746'
        },
        timestamp: moment().unix()
      });

      const handler = new Handler(eventDoc);
      await handler.processEvent();

      const doc = await mongoose.model('Crossing').findOne({ assetIdsKey: 'Crewmate:100_200' });

      expect(doc).to.eql(null);
    });
  });
});
