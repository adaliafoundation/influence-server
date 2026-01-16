const mongoose = require('mongoose');
const { isNumber } = require('lodash');
const Entity = require('@common/lib/Entity');
const CrewmateCardGenerator = require('../lib/cardGenerators/crewmate');
const EntityService = require('./Entity');

class CrewmateService {
  // Generates the NFT metadata card image
  static async generateCard({ crewmateDoc, entity, ...props }) {
    let _entity = crewmateDoc;
    if (entity) {
      _entity = await EntityService.getEntity({
        id: entity.id, label: Entity.IDS.CREWMATE, components: ['Crewmate', 'Name'], format: true
      });
    }
    return CrewmateCardGenerator.generateCard({ crewmateDoc: _entity, ...props });
  }

  /**
   * Get the crewmate's full location via the crew's location
   *
   * @param {id: {Number}, label: {Number}} entity
   */
  static async getFullLocation(id) {
    // get the crew for the entity
    const crewComponentDoc = await mongoose.model('CrewComponent').findOne({ roster: { $in: [id] } }).lean();
    if (!crewComponentDoc) return null;

    // get the crew's full location
    const locationDoc = await mongoose.model('LocationComponent').findOne({
      'entity.uuid': crewComponentDoc.entity.uuid
    });
    return (locationDoc) ? locationDoc.locations : null;
  }

  static async findByCrew(crew, { components = ['Crewmate'] } = {}, format = true) {
    const crewEntity = (isNumber(crew)) ? Entity.Crew(crew) : Entity.toEntity(crew);
    const crewComponentDoc = await mongoose.model('CrewComponent').findOne({ 'entity.uuid': crewEntity.uuid }).lean();
    if (!crewComponentDoc || crewComponentDoc.roster.length === 0) return [];
    return EntityService.getEntities({ id: crewComponentDoc.roster, label: Entity.IDS.CREWMATE, components, format });
  }
}

module.exports = CrewmateService;
