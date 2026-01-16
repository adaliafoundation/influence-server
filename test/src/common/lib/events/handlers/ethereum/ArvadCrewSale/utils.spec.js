const { expect } = require('chai');
const { packAppearance, unpackFeatures } = require('@common/lib/events/handlers/ethereum/ArvadCrewSale/utils');

describe('ArvadCrewSale::AsteroidUsed Utils', function () {
  describe('unpackFeatures', function () {
    it('should unpack features correctly', function () {
      const features = unpackFeatures(82397293850685768012593140600065n);
      expect(features).to.deep.equal({
        crewCollection: 1,
        gender: 1,
        body: 3,
        crewClass: 2,
        title: 35,
        clothes: 4,
        hair: 2,
        face: 1,
        hairColor: 4,
        head: 1,
        item: 0
      });
    });
  });

  describe('packAppearance', function () {
    it('should pack the appearance correctly', function () {
      const appearance = packAppearance(1, 2, 3, 4, 5, 6, 7, 8);
      expect(appearance).to.equal(10141340203288541999790327595041n);
    });
  });
});
