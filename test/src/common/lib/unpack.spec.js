const { expect } = require('chai');
const { unpack } = require('@common/lib/unpack');

describe('unpack utils', function () {
  describe('unpack', function () {
    it('should unpack a packed value', function () {
      let unpacked = unpack(9124194215302553302767473348436279050787479837994793466668778706n, 50);
      expect(unpacked).to.eql([1234, 2345, 3456, 4567, 5678]);

      unpacked = unpack(10889785186708835408021505n, 10);
      expect(unpacked).to.eql([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });
  });
});
