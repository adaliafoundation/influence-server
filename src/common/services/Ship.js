const mongoose = require('mongoose');
const Entity = require('@common/lib/Entity');
const ShipCardGenerator = require('../lib/cardGenerators/ship');
const EntityService = require('./Entity');

class ShipService {
  // Generates the NFT metadata card image
  static async generateCard({ entity, ship, ...props }) {
    let _entity = ship;
    if (entity) {
      _entity = await EntityService.getEntity({
        id: entity.id, label: Entity.IDS.SHIP, components: ['Ship', 'Name'], format: true
      });
    }
    return ShipCardGenerator.generateCard({ ship: _entity, ...props });
  }

  static getCountForAsteroid(asteroidEntity) {
    return mongoose.model('LocationComponent').countDocuments({
      'entity.label': Entity.IDS.SHIP,
      'locations.uuid': Entity.toEntity(asteroidEntity).uuid
    });
  }
}

module.exports = ShipService;
