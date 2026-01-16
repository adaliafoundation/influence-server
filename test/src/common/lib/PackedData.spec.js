const { expect } = require('chai');
const PackedData = require('@common/lib/PackedData');

describe('PackedData', function () {
  describe('constructor', function () {
    it('should return an instance of PackedData', function () {
      const packedData = new PackedData({ packedData: [1, 2, 3], packedWidth: 3 });
      expect(packedData).to.be.an.instanceof(PackedData);
      expect(packedData.packedData).to.deep.equal([1, 2, 3]);
      expect(packedData.packedWidth).to.equal(3);
    });
  });

  describe('toArray and valueOf', function () {
    it('should return the packedData', function () {
      const packedData = new PackedData({ packedData: [1811939328], packedWidth: 2 });
      expect(packedData.toArray()).to.deep.equal([1811939328]);
      expect(packedData.valueOf()).to.deep.equal([1811939328]);
    });
  });

  describe('toString', function () {
    it('should return the packedData in a single string', function () {
      const packedData = new PackedData({ packedData: [1811939328], packedWidth: 2 });
      expect(packedData.toString()).to.equal('01101100000000000000000000000000');
    });
  });

  describe('get', function () {
    it('should return the value at the given index', function () {
      let packedData = new PackedData({ packedData: [1811939328], packedWidth: 2 });
      expect(packedData.get(0)).to.equal('01');
      expect(packedData.get(1)).to.equal('10');
      expect(packedData.get(2)).to.equal('11');

      packedData = new PackedData({ packedData: [1811939328], packedWidth: 3 });
      expect(packedData.get(0)).to.equal('011');
      expect(packedData.get(1)).to.equal('011');
      expect(packedData.get(2)).to.equal('000');
    });
  });

  describe('set', function () {
    it('should replace the value at the given index with the specified value (width 2)', function () {
      const packedData = new PackedData({ packedData: [1811939328], packedWidth: 2 });
      packedData.set(3, '01');
      expect(packedData.valueOf()).to.deep.equal([1828716544]);
      expect(packedData.toString()).to.equal('01101101000000000000000000000000');
      expect(packedData.get(3)).to.equal('01');
    });

    it('should replace the value at the given index with the specified value (width 8)', function () {
      let packedData;
      packedData = new PackedData({
        packedData: [538976288, 538976288, 538976288, 538976288, 538976288],
        packedWidth: 8
      });

      packedData.set(0, '00010000');
      expect(packedData.valueOf()).to.deep.equal([270540832, 538976288, 538976288, 538976288, 538976288]);

      packedData = new PackedData({
        packedData: [538976288, 538976288, 538976288, 538976288, 538976288],
        packedWidth: 8
      });

      packedData.set(1, '00010000');
      expect(packedData.valueOf()).to.deep.equal([537927712, 538976288, 538976288, 538976288, 538976288]);

      packedData = new PackedData({
        packedData: [538976288, 538976288, 538976288, 538976288, 538976288],
        packedWidth: 8
      });

      packedData.set(2, '00010000');
      expect(packedData.valueOf()).to.deep.equal([538972192, 538976288, 538976288, 538976288, 538976288]);

      packedData = new PackedData({
        packedData: [538976288, 538976288, 538976288, 538976288, 538976288],
        packedWidth: 8
      });
      packedData.set(4, '10000000');
      expect(packedData.valueOf()).to.deep.equal([538976288, 2149589024, 538976288, 538976288, 538976288]);

      packedData = new PackedData({
        packedData: [538976288, 538976288, 538976288, 538976288, 538976288],
        packedWidth: 8
      });
      packedData.set(7, '10000000');
      expect(packedData.valueOf()).to.deep.equal([538976288, 538976384, 538976288, 538976288, 538976288]);
    });

    it('should replace the value at the given index with the specified value (width 10)', function () {
      let packedData = new PackedData({ packedData: [2153781254, 16777216], packedWidth: 10 });
      packedData.set(3, '1000000010');
      expect(packedData.toString()).to.equal('1000000001100000000110000000011000000010000000000000000000000000');
      expect(packedData.valueOf()).to.deep.equal([2153781254, 33554432]);

      packedData = new PackedData({ packedData: [2153781254, 16777216], packedWidth: 10 });
      packedData.set(0, '1000000010');
      expect(packedData.toString()).to.equal('1000000010100000000110000000011000000001000000000000000000000000');
      expect(packedData.valueOf()).to.deep.equal([2157975558, 16777216]);
    });
  });

  describe('fromString', function () {
    it('should correclty pack and return an instance of PackedData (width 2)', function () {
      const packedData = PackedData.fromString('011011', 2);
      expect(packedData).to.be.an.instanceof(PackedData);
      expect(packedData.valueOf()).to.deep.equal([1811939328]);
      expect(packedData.packedWidth).to.equal(2);
      expect(packedData.toString()).to.equal('01101100000000000000000000000000');
    });

    it('should correclty pack and return an instance of PackedData (width 10)', function () {
      const packedData = PackedData.fromString('1000000001100000000110000000011000000001', 10);
      expect(packedData).to.be.an.instanceof(PackedData);
      expect(packedData.valueOf()).to.deep.equal([2153781254, 16777216]);
      expect(packedData.packedWidth).to.equal(10);
      expect(packedData.toString()).to.equal('1000000001100000000110000000011000000001000000000000000000000000');
    });
  });
});
