const { expect } = require('chai');
const sinon = require('sinon');
const mongoose = require('mongoose');
const Entity = require('@common/lib/Entity');
const { NftComponentService } = require('@common/services');

describe('NftComponentService', function () {
  let sandbox;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
  });

  afterEach(function () {
    sandbox.restore();
    return this.utils.resetCollections(['CrewComponent', 'NftComponent']);
  });

  describe('flagForCardUpdate', function () {
    it('should set the updateImage to true for an existing entity', async function () {
      await mongoose.model('NftComponent').create({ entity: { id: 1, label: 1 }, updateImage: false });
      await NftComponentService.flagForCardUpdate({ id: 1, label: 1 });
      const doc = await mongoose.model('NftComponent').findOne({ 'entity.id': 1, 'entity.label': 1 });
      expect(doc.updateImage).to.equal(true);
    });

    it('should set the updateImage to true and create a document if one does not exist', async function () {
      const entity = Entity.Crew(1);
      await NftComponentService.flagForCardUpdate(entity);
      const doc = await mongoose.model('NftComponent').findOne({ 'entity.uuid': entity.uuid });
      expect(doc.updateImage).to.equal(true);
    });

    it('should attempt to flag related documents if flagRelatedForCardUpdate is true', async function () {
      sandbox.stub(NftComponentService, 'flagRelatedForCardUpdate').resolves();
      await NftComponentService.flagForCardUpdate({ id: 1, label: 1 }, true);
      expect(NftComponentService.flagRelatedForCardUpdate.calledOnce).to.equal(true);
    });

    it('should do nothing if the entity type is not supported', async function () {
      for (const label of [4, 5, 7, 8, 9]) {
        const result = await NftComponentService.flagForCardUpdate({ id: 1, label });
        expect(result).to.equal(null);
      }
    });
  });

  describe('flagRelatedForCardUpdate', function () {
    it('should flag the crew entity for card update if the crewmate is a captain', async function () {
      await mongoose.model('CrewComponent').create({ entity: { id: 1, label: 1 }, roster: [1, 2, 3] });
      await NftComponentService.flagRelatedForCardUpdate({ id: 1, label: 2 });
      const doc = await mongoose.model('NftComponent').findOne({ 'entity.id': 1, 'entity.label': 1 });
      expect(doc.updateImage).to.equal(true);
    });
  });
});
