const mongoose = require('mongoose');
const { Address, Asteroid, Building, ColonizationMission, Entity, Mission } = require('@influenceth/sdk');
const { felt, subjectUuid } = require('@common/lib/missions');
const { readCells } = require('@common/lib/missionState');
const { componentSource } = require('@common/lib/missionBindings');
const ConstantService = require('./Constant');
const MissionService = require('./Mission');

const address = (value) => (value && BigInt(value) !== 0n ? Address.toStandard(value, 'starknet') : null);
const branches = ['habitat', 'spaceport', 'marketplace'];

class ColonizationMissionService {
  static async getSelectedBuildings(assignment, ids) {
    const entities = ids.map((id) => ({ label: Entity.IDS.BUILDING, id }));
    const uuids = entities.map(subjectUuid);
    const [buildings, locations, evidence] = await Promise.all([
      mongoose.model('BuildingComponent').find({ 'entity.uuid': { $in: uuids } }).lean(),
      mongoose.model('LocationComponent').find({ 'entity.uuid': { $in: uuids } }).lean(),
      readCells(entities.flatMap((entity) => ['Built', 'Used'].map((kind) => {
        const slot = ColonizationMission.getActionEvidenceSlot({ kind, entity });
        return Mission.getEvidencePath(assignment, slot);
      })))
    ]);
    const events = await mongoose.model('Starknet').find({
      _id: { $in: buildings.flatMap((building) => (building.event?.id ? [building.event.id] : [])) }
    }).lean();

    return entities.map((entity, index) => {
      const result = {
        mission: index + 1, buildingId: entity.id === '0' ? null : entity.id, ready: false, reason: null
      };
      const unavailable = (reason) => ({ ...result, reason });
      if (entity.id === '0') return unavailable('no_selected_building');
      const building = buildings.find((item) => item.entity.uuid === uuids[index]);
      if (!building) return unavailable('building_not_indexed');
      const event = events.find((item) => String(item._id) === String(building.event?.id));
      // Hash retained Cairo integers, never rounded display values.
      const { data, reason } = componentSource('Building', event, entity);
      if (reason) return unavailable(reason);
      if (Number(data.building_type) !== ColonizationMission.TYPES[index + 1].requirements.buildingType) {
        return unavailable('wrong_building_type');
      }
      if (Number(data.status) !== Building.CONSTRUCTION_STATUSES.OPERATIONAL) return unavailable('not_operational');
      const location = locations.find((item) => item.entity.uuid === uuids[index]);
      if (!location) return unavailable('location_not_indexed');
      if (!location.locations.some((item) => item.label === Entity.IDS.ASTEROID
        && String(item.id) === String(assignment.subject.id))) return unavailable('wrong_asteroid');
      const fingerprint = ColonizationMission.getBuildingFingerprint(entity, data).toString();
      if (evidence[index * 2] !== fingerprint) return unavailable('construction_not_observed');
      if (evidence[index * 2 + 1] !== fingerprint) return unavailable('use_not_observed');
      return { ...result, ready: true };
    });
  }

  static async getState(asteroidId) {
    const subject = { label: Entity.IDS.ASTEROID, id: felt(asteroidId) };
    const uuid = subjectUuid(subject);
    const constant = await ConstantService.getConstant('COLONIZATION_CAMPAIGN');
    const campaign = constant ? felt(constant.value) : '0';
    const [state, celestial, nft] = await Promise.all([
      campaign !== '0' ? MissionService.getSubject(campaign, subject) : null,
      mongoose.model('CelestialComponent').findOne({ 'entity.uuid': uuid }).lean(),
      mongoose.model('NftComponent').findOne({ 'entity.uuid': uuid }).lean()
    ]);
    const owner = address(nft?.owners?.starknet);
    const result = {
      campaign: campaign === '0' ? null : campaign,
      active: state?.missionCount === 5,
      subject,
      subjectUuid: uuid,
      owner,
      colonizer: null,
      enrolled: false,
      canEnroll: false,
      recipient: null,
      progress: null,
      missions: []
    };
    if (!result.active) return result;
    const assignment = { campaign, subject };
    const slots = ColonizationMission.EVIDENCE_SLOTS;
    const values = await readCells(
      ['COLONIZER', 'SCAN_STARTED', 'SCAN_FINISHED', 'EARNED', 'HABITAT', 'SPACEPORT', 'MARKETPLACE']
        .map((name) => Mission.getEvidencePath(assignment, slots[name]))
    );
    const [colonizer, scanStarted, scanFinished, earnedWord, ...ids] = values;
    result.colonizer = address(colonizer);
    result.recipient = result.colonizer;
    result.enrolled = state.missions[0].accepted;
    result.canEnroll = Boolean(owner && !result.enrolled && !result.colonizer
      && celestial?.scanStatus === Asteroid.SCAN_STATUSES.UNSCANNED);
    result.progress = {
      scanStatus: celestial?.scanStatus ?? null,
      scanStarted,
      scanFinished,
      earned: ColonizationMission.unpackEarned(earnedWord),
      selectedBuildingIds: ids
    };
    result.missions = state.missions;
    return result;
  }

  static async getSummary(asteroidId) {
    const result = await this.getState(asteroidId);
    if (!result.active) return result;
    const { campaign, subject, progress } = result;
    const { selectedBuildingIds, earned, ...scan } = progress;
    const [selectedBuildings, rewards] = await Promise.all([
      this.getSelectedBuildings({ campaign, subject }, selectedBuildingIds),
      // Path keys also find rewards indexed with Unknown metadata before SDK 2.8.0.
      readCells(result.missions.map(({ mission }) => (
        ColonizationMission.getRewardPath({ campaign, missionId: mission })
      )))
    ]);
    const capstoneReady = selectedBuildings.every(({ ready }) => ready);
    const ownsColony = Boolean(result.colonizer && result.owner === result.colonizer);
    result.progress = { ...scan, earned, selectedBuildings, capstoneReady };
    result.missions = result.missions.map((lifecycle) => {
      const { mission } = lifecycle;
      let claimBlockedReason = null;
      if (lifecycle.claimed) claimBlockedReason = 'already_claimed';
      else if (!lifecycle.accepted) claimBlockedReason = 'not_accepted';
      else if (!lifecycle.completed) claimBlockedReason = 'not_completed';
      else if (!ownsColony) claimBlockedReason = 'colonizer_not_owner';
      else if (mission === 4 && !capstoneReady) claimBlockedReason = 'colony_not_operational';
      return {
        ...ColonizationMission.TYPES[mission],
        ...lifecycle,
        earned: mission === 4 ? capstoneReady : earned[['scan', ...branches][mission]],
        rewardMicroSway: rewards[mission],
        canAccept: !lifecycle.accepted && (mission === 0 ? result.canEnroll
          : ownsColony && result.missions[0].completed),
        claimable: claimBlockedReason === null,
        claimBlockedReason
      };
    });
    return result;
  }
}

module.exports = ColonizationMissionService;
