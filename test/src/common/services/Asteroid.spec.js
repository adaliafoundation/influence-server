const { expect } = require('chai');
const mongoose = require('mongoose');
const { AsteroidService } = require('@common/services');
const AsteroidCardGenerator = require('@common/lib/cardGenerators/asteroid');

describe('AsteroidService', function () {
  afterEach(function () {
    return this.utils.resetCollections(['Entity']);
  });

  describe('generateCard', function () {
    it('should call card generator generateCard', async function () {
      const stub = this._sandbox.stub(AsteroidCardGenerator, 'generateCard').resolves();
      await mongoose.model('Entity').create({ id: 1, label: 3 });
      const asteroidDoc = { id: 1 };
      await AsteroidService.generateCard({ asteroidDoc });
      expect(stub.calledWith({ asteroidDoc })).to.eql(true);
    });
  });
});
