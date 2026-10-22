const mongoose = require('mongoose');
const { Asteroid, Building, ColonizationMission, Entity, StarterMission } = require('@influenceth/sdk');
const { subjectUuid } = require('@common/lib/missions');
const { observationSystems } = require('@common/lib/missionObservation');
const MissionService = require('./Mission');
const ColonizationMissionService = require('./ColonizationMission');

const starterBuildings = Object.fromEntries(Object.values(StarterMission.TYPES)
  .filter(({ requirements }) => requirements.requiresCampaignConstruction || requirements.requiresCampaignWarehouse)
  .map(({ requirements, id }) => [requirements.buildingType, id]));

class MissionObservationService {
  static async getCandidates({ system, target, crewId, buildingType }) {
    const definition = observationSystems[system];
    const [starter, building, location] = await Promise.all([
      crewId && definition.starter ? MissionService.getStarter(crewId) : null,
      target.label === Entity.IDS.BUILDING
        ? mongoose.model('BuildingComponent').findOne({ 'entity.uuid': subjectUuid(target) }).lean() : null,
      definition.colony !== undefined && target.label === Entity.IDS.BUILDING
        ? mongoose.model('LocationComponent').findOne({ 'entity.uuid': subjectUuid(target) }).lean() : null
    ]);
    const asteroid = target.label === Entity.IDS.ASTEROID ? target
      : location?.locations.find((entity) => entity.label === Entity.IDS.ASTEROID);
    const kind = building?.buildingType ?? buildingType;
    const candidates = [];
    const add = (state, missions) => missions.forEach((mission) => {
      candidates.push({ campaign: state.campaign, subject: state.subject, mission });
    });

    if (starter?.active && starter.eligible && starter.missions[0].accepted) {
      let missions = definition.starter || [];
      if (system === 'ConstructionPlan') {
        // A second warehouse cannot be observed by the starter campaign.
        missions = [];
        if (kind === Building.IDS.WAREHOUSE && !starter.progress.warehouseId) missions = [0];
        else if (kind !== Building.IDS.WAREHOUSE && starterBuildings[kind] !== undefined) {
          missions = [starterBuildings[kind]];
        }
      } else if (system === 'ConstructionStart' || system === 'ConstructionFinish') {
        const selected = kind !== Building.IDS.WAREHOUSE || starter.progress.warehouseId === String(target.id);
        missions = selected && starterBuildings[kind] !== undefined ? [starterBuildings[kind]] : [];
        if (system === 'ConstructionStart' && missions.length) missions.push(7);
      } else if (system === 'ProcessProductsStart' || system === 'ProcessProductsFinish') {
        missions = [Building.IDS.REFINERY, Building.IDS.BIOREACTOR, Building.IDS.FACTORY].includes(kind)
          ? [starterBuildings[kind], 3, 7] : [];
      }
      // Later missions still need provenance before acceptance or after another mission is paid.
      add(starter, missions);
    }

    if (asteroid && definition.colony !== undefined) {
      const colony = await ColonizationMissionService.getState(asteroid.id);
      if (colony.active && colony.enrolled) {
        if (definition.colony === 0) {
          const { scanStatus, scanStarted, earned } = colony.progress;
          const ready = system === 'ScanSurfaceStart'
            ? scanStatus === Asteroid.SCAN_STATUSES.UNSCANNED && scanStarted === '0'
            : scanStatus === Asteroid.SCAN_STATUSES.SURFACE_SCANNING && scanStarted !== '0';
          if (colony.colonizer && colony.owner === colony.colonizer && !earned.scan && ready) add(colony, [0]);
        } else if (colony.progress.earned.scan) {
          const branch = [1, 2, 3].find((mission) => (
            ColonizationMission.TYPES[mission].requirements.buildingType === kind
          ));
          if ((system === 'ConstructionStart' || system === 'ConstructionFinish') && branch) {
            add(colony, [branch]);
          } else if (branch && definition.colony === branch) {
            add(colony, [branch, 4]);
          }
        }
      }
    }
    return { system, target, candidates };
  }
}

module.exports = MissionObservationService;
