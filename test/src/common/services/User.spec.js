const { expect } = require('chai');
const mongoose = require('mongoose');
const { Address } = require('@influenceth/sdk');
const { UserService } = require('@common/services');

describe('UserService', function () {
  afterEach(function () {
    return this.utils.resetCollections(['User']);
  });

  describe('findOrCreateByAddress', function () {
    it('should create a new user if not exists', async function () {
      const result = await UserService.findOrCreateByAddress({
        address: '0x123456789'
      });
      expect(result).to.be.an('object');
      expect(result.address).to.equal(Address.toStandard('0x123456789'));
    });

    it('should set the referredBy only on insert', async function () {
      const address = '0x123456789';
      const referredBy = '0x987654321';
      let result = await UserService.findOrCreateByAddress({ address, referredBy });
      expect(result.referredBy).to.equal(Address.toStandard(referredBy));

      result = await UserService.findOrCreateByAddress({ address, referredBy: '0x9876543212' });
      expect(result.referredBy).to.equal(Address.toStandard(referredBy));
    });

    it('should throw an error if address is not provided', async function () {
      let _error;
      try {
        await UserService.findOrCreateByAddress({ referredBy: '0x987654321' });
      } catch (error) {
        _error = error;
      }
      expect(_error).to.be.an('error');
    });
  });

  describe('watchAsteroid', function () {
    it('should add an asteroid to the watchlist', async function () {
      const user = await mongoose.model('User').create({ address: '0x123456789' });
      const asteroid = '12345';
      await UserService.watchAsteroid({ asteroid, user });
      expect(user.hasWatchedAsteroid(asteroid)).to.equal(true);
    });
  });

  describe('unwatchAsteroid', function () {
    it('should remove an asteroid from the watchlist', async function () {
      const user = await mongoose.model('User').create({ address: '0x123456789' });
      const asteroid = '12345';
      await UserService.watchAsteroid({ asteroid, user });
      await UserService.unwatchAsteroid({ asteroid, user });
      expect(user.hasWatchedAsteroid(asteroid)).to.equal(false);
    });
  });
});
