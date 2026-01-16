const { expect } = require('chai');
const bcrypt = require('bcrypt');
const hash = require('@common/lib/hash');

describe('hash utils', function () {
  describe('md5', function () {
    it('should create an md5 hash for the specified string', function () {
      const result = hash.md5('test');
      expect(result).to.equal('098f6bcd4621d373cade4e832627b4f6');
    });
  });

  describe('sha256', function () {
    it('should create an sha256 hash for the specified string', function () {
      const result = hash.sha256('test');
      expect(result).to.equal('36f028580bb02cc8272a9a020f4200e346e276ae664e45ee80745574e2f5ab80');
    });
  });

  describe('poseidonHashMany', function () {
    it('should create a poseidon hash for an array of values', function () {
      expect(hash.poseidonHashMany(['0x1']))
        .to.equal('0x579e8877c7755365d5ec1ec7d3a94a457eff5d1f40482bbe9729c064cdead2');

      expect(hash.poseidonHashMany(['0x1', '0x2']))
        .to.equal('0x371cb6995ea5e7effcd2e174de264b5b407027a75a231a70c2c8d196107f0e7');

      expect(hash.poseidonHashMany([1n, '0x2']))
        .to.equal('0x371cb6995ea5e7effcd2e174de264b5b407027a75a231a70c2c8d196107f0e7');

      expect(hash.poseidonHashMany([1n, 2n]))
        .to.equal('0x371cb6995ea5e7effcd2e174de264b5b407027a75a231a70c2c8d196107f0e7');

      expect(hash.poseidonHashMany(['0x0']))
        .to.equal('0x545d6f7d28a8a398e543948be5a026af60c4dea482867a6eeb2525b35d1e1e1');

      expect(hash.poseidonHashMany([0]))
        .to.equal('0x545d6f7d28a8a398e543948be5a026af60c4dea482867a6eeb2525b35d1e1e1');
    });

    it('should throw an error if not passed an array', function () {
      expect(() => hash.poseidonHashMany('0x1')).to.throw('Invalid value');
    });
  });

  describe('apiKey', function () {
    describe('generateHash', function () {
      it('should generate a hash for the specified secret', async function () {
        const key = '15f50f1b-139f-420d-92ea-1cb45c7ad2e8';
        const _hash = hash.apiKey.generateHash(key);
        const isValid = bcrypt.compareSync(key, _hash);
        expect(isValid).to.eql(true);
      });
    });
  });
});
