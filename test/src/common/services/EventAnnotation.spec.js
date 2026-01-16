const { expect } = require('chai');
const sinon = require('sinon');
const mongoose = require('mongoose');
const EventAnnotationService = require('@common/services/EventAnnotation');
const { InfuraIpfs } = require('@common/lib/Ipfs');

describe('AnnotationService', function () {
  let sandbox;
  let pinStub;

  beforeEach(async function () {
    sandbox = sinon.createSandbox();
    pinStub = sandbox.stub(InfuraIpfs.prototype, 'addData').resolves({ hash: '123123123' });
  });

  afterEach(async function () {
    sandbox.restore();
    pinStub.restore();
    return this.utils.resetCollections(['Event', 'EventAnnotation']);
  });

  describe('findOrCreate', function () {
    it('should create a EventAnnotation correctly (annotation provided)', async function () {
      await mongoose.model('Starknet').create({
        transactionHash: '0x1',
        logIndex: 1,
        event: 'EventAnnotated',
        blockNumber: 1,
        blockHash: '0x1',
        timestamp: 1,
        returnValues: {
          transactionHash: '0x2',
          logIndex: 2,
          contentHash: '123123123',
          callerCrew: { label: 1, id: 1 },
          caller: this.GLOBALS.TEST_STARKNET_WALLET
        }
      });

      const result = await EventAnnotationService.findOrCreate({
        annotation: JSON.stringify({ content: 'test', type: 'EventAnnotation', version: 1 }),
        caller: this.GLOBALS.TEST_STARKNET_WALLET,
        callerCrew: { label: 1, id: 1 },
        contentHash: '123123123',
        event: { transactionHash: '0x2', logIndex: 2 },
        pin: true
      });

      expect(result.toJSON()).to.have.keys(['id', 'address', 'annotated', 'crew', 'ipfs', 'createdAt', 'updatedAt']);
      expect(result.ipfs.pinned).to.eql(true);
      expect(result.ipfs.hash).to.eql('123123123');
    });
  });
});
