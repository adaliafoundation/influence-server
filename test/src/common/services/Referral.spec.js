const { expect } = require('chai');
const mongoose = require('mongoose');
const Entity = require('@common/lib/Entity');
const { ReferralService } = require('@common/services');

describe('ReferralService', function () {
  afterEach(function () {
    return this.utils.resetCollections(['Referral', 'User']);
  });

  describe('createReferralForBuyer', function () {
    it('should create a referral document for the specified buyer', async function () {
      const user = await mongoose.model('User').create({
        address: '0x041a3078c15fed9978b0e5bc37119e1cafc0ad659aebdc90f5f3fc8bd446f674',
        referredBy: '0x041a3078c15fed9978b0e5bc37119e1cafc0ad659aebdc90f5f3fc8bd446f675'
      });

      const doc = await ReferralService.createReferralForBuyer(user.address, Entity.Asteroid(1));
      expect(doc.buyer).to.equal(user.address);
      expect(doc.referrer).to.equal(user.referredBy);
      expect(doc.entity.toJSON()).to.deep.equal(Entity.Asteroid(1));
    });

    it('should throw an error if the user is not found', async function () {
      let _error;
      try {
        await ReferralService.createReferralForBuyer('0x123123123', Entity.Asteroid(1));
      } catch (error) {
        _error = error;
      }
      expect(_error).to.be.an.instanceOf(Error);
    });

    it('should return null if the user does not have a referredBy', async function () {
      const user = await mongoose.model('User').create({
        address: '0x041a3078c15fed9978b0e5bc37119e1cafc0ad659aebdc90f5f3fc8bd446f674'
      });

      const doc = await ReferralService.createReferralForBuyer(user.address, Entity.Asteroid(1));
      expect(doc).to.equal(null);
    });
  });
});
