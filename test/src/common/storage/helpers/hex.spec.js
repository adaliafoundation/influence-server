const { expect } = require('chai');
const { Hex } = require('@common/storage/db/helpers');

describe('Hex mongoose helper', function () {
  describe('toHex64', function () {
    it('should return null if value is null', function () {
      expect(Hex.toHex64(null)).to.eql(null);
    });

    it('should return null if value is undefined', function () {
      expect(Hex.toHex64(undefined)).to.eql(null);
    });

    it('should return null if value is empty string', function () {
      expect(Hex.toHex64('')).to.eql(null);
    });

    it('should standardize a hex string to 64 length', function () {
      expect(Hex.toHex64('0x0'))
        .to.eql('0x0000000000000000000000000000000000000000000000000000000000000000');
      expect(Hex.toHex64('0xc5ad303431b3c5ef6939eef3b339afc04c46aa33cfa0180962b6b756500c4'))
        .to.eql('0x000c5ad303431b3c5ef6939eef3b339afc04c46aa33cfa0180962b6b756500c4');
      expect(Hex.toHex64('0x00c5ad303431b3c5ef6939eef3b339afc04c46aa33cfa0180962b6b756500c4'))
        .to.eql('0x000c5ad303431b3c5ef6939eef3b339afc04c46aa33cfa0180962b6b756500c4');
      expect(Hex.toHex64('0x00c5aD303431B3c5ef6939eef3b339afc04c46aa33cfa0180962b6b756500c4'))
        .to.eql('0x000c5ad303431b3c5ef6939eef3b339afc04c46aa33cfa0180962b6b756500c4');
    });
  });
});
