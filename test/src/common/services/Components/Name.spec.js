const { expect } = require('chai');
const mongoose = require('mongoose');
const Entity = require('@common/lib/Entity');
const { NameComponentService } = require('@common/services');

describe('NameComponentService', function () {
  afterEach(function () {
    return this.utils.resetCollections(['NameComponent']);
  });

  describe('findByRoster', function () {
    it('should return NameComponent docs for the specified roster', async function () {
      await mongoose.model('NameComponent').create([
        { entity: Entity.Crewmate(1), name: 'Crewmate1' },
        { entity: Entity.Crewmate(2), name: 'Crewmate2' },
        { entity: Entity.Crewmate(3), name: 'Crewmate3' },
        { entity: Entity.Crewmate(4), name: 'Crewmate4' }
      ]);

      const docs = await NameComponentService.findByRoster([1, 2, 3]);
      expect(docs).to.have.lengthOf(3);
    });
  });
});
