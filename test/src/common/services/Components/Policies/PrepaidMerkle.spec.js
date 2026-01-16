const { expect } = require('chai');
const sinon = require('sinon');
const mongoose = require('mongoose');
const Entity = require('@common/lib/Entity');
const { PrepaidMerklePolicyService } = require('@common/services');
const { InfuraIpfs } = require('@common/lib/Ipfs');

describe('PrepaidMerklePolicyService', function () {
  let sandbox;
  let pinStub;

  beforeEach(async function () {
    sandbox = sinon.createSandbox();
    pinStub = sandbox.stub(InfuraIpfs.prototype, 'addData').resolves({ hash: '0x1234' });
  });

  afterEach(function () {
    sandbox.restore();
    pinStub.restore();
    return this.utils.resetCollections(['PrepaidMerklePolicyComponent']);
  });

  describe('uploadMerkleTree', function () {
    it('should upload/pin the merkletree and update the correct PrepaidMerklePolicyComponent doc', async function () {
      await mongoose.model('PrepaidMerklePolicyComponent').create({
        entity: Entity.Asteroid(250_000),
        initialTerm: 2,
        merkleRoot: '0x22e2a64ace0db2d727a85c6cfc02416806093d6dd61588ac068ffa107b7aea8',
        noticePeriod: 3,
        permission: 1,
        rate: 4
      });

      const result = await PrepaidMerklePolicyService.uploadMerkleTree({
        entity: Entity.Asteroid(250_000),
        permission: 1,
        merkleTree: [
          [
            '0x10003d0900004', '0x20003d0900004',
            '0x30003d0900004', '0x40003d0900004',
            '0x50003d0900004', '0x60003d0900004',
            '0x70003d0900004', '0x80003d0900004',
            '0x90003d0900004', '0xa0003d0900004',
            '0xb0003d0900004', '0xc0003d0900004',
            '0xd0003d0900004', 0
          ],
          [
            '0x44d0f4112cc1776dfd911d22719d7a395717f59edaefd952aa51f919722bf18',
            '0x7b2e888089f53082495f6c689ae54ec4267defa300d8ce61378337cf69f042d',
            '0x6974411f0e82b7fd8b013d2acd48754fc6b02f987ef5bf5c8ddf575e6031830',
            '0x47e43f0f2484e805cbb902d049fde00ca798f3d4d23f89dab44298b93b7a500',
            '0x3809ca191abbddb9e201ed61d1593fc4fe1df00c25a0903c6cdc60cee42572c',
            '0x59082574619ef9b0bfa2ca14281118d89367b78d556fd3f6dfff5801e153ebb',
            '0x670beebb0642735d8718884d7076c13ff7cfe87d13c4e77c15e7c8416eeff03',
            0
          ],
          [
            '0x7e215c78e071b56b9a63ff386eea29f67e11d32bd5b263c3f54dfd6bacfed92',
            '0x34c7d09e9f81c46d978e3f318ed3dca4a39c34ce9e0ebe1b98c96f0d5a0ef9b',
            '0x10466e884492dd16892d65f3b421990a1eed7a5308850ee80fe72a0806959c7',
            '0x4ffebd3ea404d15fd9ac0d7229a1a0452ee03a1c3535194868e0f6118890631'
          ],
          [
            '0x460014ba0e7a4677115790c182fcaa429f10d35345f8d9b0b1167f0027e6b72',
            '0x160fe687cb65607eed50bafa27227aa8e50a335f0b140fce3bd07752774204e'
          ],
          [
            '0x22e2a64ace0db2d727a85c6cfc02416806093d6dd61588ac068ffa107b7aea8'
          ]
        ]
      });
      expect(result.merkleTreeIpfsHash).to.equal('0x1234');
      expect(result.lotIndices).to.deep.equal([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    });

    it('should throw an error if the PrepaidMerklePolicyComponent doc does not exist', async function () {
      let _error;
      try {
        await PrepaidMerklePolicyService.uploadMerkleTree({
          entity: Entity.Asteroid(1),
          permission: 1,
          merkleTree: [['0x38118a340bbba28e678413cd3b07a9436a5e60fd6a7cbda7db958a6d501e274']]
        });
      } catch (error) {
        _error = error;
      }
      expect(_error.message).to.equal('No matching prepaid merkle policy found');
    });

    it('should throw an error if the merkle tree or root is invalid', async function () {
      let _error;
      await mongoose.model('PrepaidMerklePolicyComponent').create({
        entity: Entity.Asteroid(1),
        initialTerm: 2,
        merkleRoot: '0x38118a340bbba28e678413cd3b07a9436a5e60fd6a7cbda7db958a6d501e274',
        noticePeriod: 3,
        permission: 1,
        rate: 4
      });

      try {
        await PrepaidMerklePolicyService.uploadMerkleTree({
          entity: Entity.Asteroid(1),
          permission: 1,
          merkleTree: []
        });
      } catch (error) {
        _error = error;
      }

      expect(_error.message).to.match(/Invalid merkle tree or root/);

      try {
        await PrepaidMerklePolicyService.uploadMerkleTree({
          entity: Entity.Asteroid(1),
          permission: 1,
          merkleTree: [['0x38118a340bbba28e678413cd3b07a9436a5e60fd6a7cbda7db958a6d501e275']]
        });
      } catch (error) {
        _error = error;
      }

      expect(_error.message).to.match(/Invalid merkle tree or root/);
    });
  });
});
