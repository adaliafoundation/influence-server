const mongoose = require('mongoose');
const { get, isNil, isNumber } = require('lodash');
const Logger = require('@common/lib/logger');
const { Address } = require('@influenceth/sdk');
const Entity = require('@common/lib/Entity');
const CrewCardGenerator = require('../lib/cardGenerators/crew');
const EntityService = require('./Entity');

class CrewService {
  // Generates the NFT metadata card image
  static async generateCard({ crewmateDoc, crewDoc, crewEntity, crewmateEntity, ...props }) {
    let _crewEntity = crewDoc;
    let _crewmateEntity = crewmateDoc;

    if (crewEntity) {
      _crewEntity = await EntityService.getEntity({
        id: crewEntity.id, label: Entity.IDS.CREW, components: ['Crew', 'Name'], format: true
      });
    }
    if (crewmateEntity) {
      _crewmateEntity = await EntityService.getEntity({
        id: crewmateEntity.id, label: Entity.IDS.CREWMATE, components: ['Crewmate', 'Name'], format: true
      });
    }

    // attempt to find the crewmate's captain
    if (!_crewmateEntity) {
      const captainId = get(_crewEntity, 'Crew.roster[0]');
      if (!captainId) {
        Logger.warn(`No captain found for crew with id ${_crewEntity.id}`);
      } else {
        _crewmateEntity = await EntityService.getEntity({
          id: captainId, label: Entity.IDS.CREWMATE, components: ['Crewmate', 'Name'], format: true
        });
      }
    }

    return CrewCardGenerator.generateCard({ crewmate: _crewmateEntity, crew: _crewEntity, ...props });
  }

  static async findStation(crew, { lean = true } = {}) {
    const crewEntity = (isNumber(crew)) ? Entity.Crew(crew) : Entity.toEntity(crew);

    // get the full location for the specified crew
    const locationComponentDoc = await mongoose.model('LocationComponent').findOne({ 'entity.uuid': crewEntity.uuid });
    if (!locationComponentDoc) throw new Error('Unable to find location for crew');

    return mongoose.model('StationComponent').findOne({ 'entity.uuid': locationComponentDoc.location.uuid }).lean(lean);
  }

  static getCountForAsteroid(asteroidEntity) {
    return mongoose.model('LocationComponent').countDocuments({
      'entity.label': Entity.IDS.CREW,
      'locations.uuid': Entity.toEntity(asteroidEntity).uuid
    });
  }

  static getCrewForCrewmate(crewmateEntity, { lean = true } = {}) {
    return mongoose.model('CrewComponent').findOne({ roster: crewmateEntity.id }).lean(lean);
  }

  static async isCaptain(crew, crewmate) {
    if (!crew) throw Error('crew entity or crew component doc required');
    if (!crewmate) throw Error('crewmate entity or crewmate component doc required');

    let _crewComponentDoc = crew;
    const crewmateEntity = Entity.toEntity(crewmate);

    if (!crew.roster) {
      _crewComponentDoc = await mongoose.mongoose.model('CrewComponent').findOne({ 'entity.id': crew.id }).lean();
    }

    return (get(_crewComponentDoc, 'roster[0]') === crewmateEntity.id);
  }

  static async isDelegatedTo({ crew, address } = {}) {
    if (!crew) throw Error('crew required');
    if (!address) throw Error('address required');

    const crewEntity = Entity.toEntity(crew);
    const result = await mongoose.model('CrewComponent').exists({
      'entity.uuid': crewEntity.uuid,
      delegatedTo: Address.toStandard(address)
    });

    return !isNil(result);
  }
}

module.exports = CrewService;
