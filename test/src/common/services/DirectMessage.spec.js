const { expect } = require('chai');
const mongoose = require('mongoose');
const DirectMessageService = require('@common/services/DirectMessage');
const { InfuraIpfs } = require('@common/lib/Ipfs');
const UserFactory = require('../../../factories/User');

describe('DirectMessage', function () {
  before(function () {
    return UserFactory.createOne({ address: this.GLOBALS.TEST_STARKNET_WALLET });
  });

  beforeEach(async function () {
    this._sandbox.stub(InfuraIpfs.prototype, 'addData').resolves({ hash: '123123123' });
  });

  afterEach(async function () {
    return this.utils.resetCollections(['Event', 'DirectMessage', 'User']);
  });

  describe('findOrCreate', function () {
    it('should create a DirectMessaged correctly (message provided)', async function () {
      const event = await mongoose.model('Starknet').create({
        transactionHash: '0x1',
        transactionIndex: 1,
        logIndex: 1,
        event: 'DirectMessageSent',
        blockNumber: 1,
        blockHash: '0x1',
        timestamp: 1,
        returnValues: {
          recipient: this.GLOBALS.TEST_STARKNET_WALLET,
          contentHash: '123123123',
          caller: this.GLOBALS.TEST_STARKNET_WALLET
        }
      });

      const result = await DirectMessageService.findOrCreate({
        caller: this.GLOBALS.TEST_STARKNET_WALLET,
        contentHash: '123123123',
        event,
        pin: true,
        recipient: this.GLOBALS.TEST_STARKNET_WALLET
      });

      expect(result.toJSON())
        .to.have.keys(['id', 'event', 'sender', 'recipient', 'ipfs', 'createdAt', 'read', 'updatedAt']);
      expect(result.ipfs.pinned).to.eql(true);
      expect(result.ipfs.hash).to.eql('123123123');
      expect(result.read).to.eql(false);
    });
  });
});
