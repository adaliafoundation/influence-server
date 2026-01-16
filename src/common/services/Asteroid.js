const { Entity } = require('@influenceth/sdk');
const AsteroidCardGenerator = require('../lib/cardGenerators/asteroid');
const EntityService = require('./Entity');

class AsteroidService {
  // Generates the NFT metadata card image
  static async generateCard({ asteroidDoc, entity, ...props }) {
    let _entity = asteroidDoc;
    if (entity) {
      _entity = await EntityService.getEntity({
        id: entity.id, label: Entity.IDS.ASTEROID, components: ['Celestial', 'Orbit', 'Name'], format: true
      });
    }
    return AsteroidCardGenerator.generateCard({ asteroidDoc: _entity, ...props });
  }
}

module.exports = AsteroidService;
