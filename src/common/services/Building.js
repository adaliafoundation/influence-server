const mongoose = require('mongoose');
const Entity = require('@common/lib/Entity');

class BuildingService {
  static async getCountForAsteroid(asteroidEntity) {
    const result = await mongoose.model('LocationComponent').aggregate([
      { $match: { 'entity.label': Entity.IDS.BUILDING, 'locations.uuid': Entity.toEntity(asteroidEntity).uuid } },
      {
        $lookup: {
          from: 'Component_Building',
          localField: 'entity.uuid',
          foreignField: 'entity.uuid',
          as: 'Building'
        }
      },
      { $match: { 'Building.status': { $gt: 0 } } },
      { $count: 'count' }
    ]);
    return result[0]?.count || 0;
  }
}

module.exports = BuildingService;
