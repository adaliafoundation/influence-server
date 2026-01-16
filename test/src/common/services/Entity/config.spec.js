const { expect } = require('chai');
const Entity = require('@common/lib/Entity');
const EntityConfig = require('@common/services/Entity/config');

describe('Entity Config', function () {
  describe('getByLabel', function () {
    it('should return the components config for an asteroid', function () {
      const config = EntityConfig.getByLabel(Entity.IDS.ASTEROID);
      expect(config.components).to.be.an('array');
    });

    it('should return the components config for a building', function () {
      const config = EntityConfig.getByLabel(Entity.IDS.BUILDING);
      expect(config.components).to.be.an('array');
    });

    it('should return the components config for a crew', function () {
      const config = EntityConfig.getByLabel(Entity.IDS.CREW);
      expect(config.components).to.be.an('array');
    });

    it('should return the components config for a crewmate', function () {
      const config = EntityConfig.getByLabel(Entity.IDS.CREWMATE);
      expect(config.components).to.be.an('array');
    });

    it('should return the components config for a delivery', function () {
      const config = EntityConfig.getByLabel(Entity.IDS.DELIVERY);
      expect(config.components).to.be.an('array');
    });

    it('should return the components config for a deposit', function () {
      const config = EntityConfig.getByLabel(Entity.IDS.DEPOSIT);
      expect(config.components).to.be.an('array');
    });

    it('should return the components config for a lot', function () {
      const config = EntityConfig.getByLabel(Entity.IDS.LOT);
      expect(config.components).to.be.an('array');
    });

    it('should return the components config for a ship', function () {
      const config = EntityConfig.getByLabel(Entity.IDS.SHIP);
      expect(config.components).to.be.an('array');
    });

    it('should return a config with a filtered list of components', function () {
      const config = EntityConfig.getByLabel(Entity.IDS.ASTEROID, ['Control', 'Celestial']);
      expect(config.components).to.be.an('array');
      expect(config.components.length).to.equal(2);
    });

    it('should create a config from a list of provided components', function () {
      let result = EntityConfig.getByLabel(null, ['Control', 'Celestial']);
      expect(result).to.deep.equal({ components: [{ component: 'Control' }, { component: 'Celestial' }] });

      result = EntityConfig.getByLabel(null, ['Delivery']);
      expect(result.components[0].component).to.equal('Delivery');
      expect(result.components[0].components).to.be.an('array');
    });
  });
});
