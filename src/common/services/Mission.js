const mongoose = require('mongoose');
const { Mission, StarterMission, Entity } = require('@influenceth/sdk');
const { felt, jsonSafe, pathKey, subjectUuid, slotOrder } = require('@common/lib/missions');
const ConstantService = require('./Constant');

const model = () => mongoose.model('MissionComponent');
const readCells = async (paths) => {
  const cells = await model().find({ pathKey: { $in: paths.map(pathKey) } }).lean();
  const values = new Map(cells.map((cell) => [cell.pathKey, cell.value]));
  return paths.map((path) => values.get(pathKey(path)) || '0');
};

class MissionService {
  static async getCampaign(campaignId) {
    const campaign = felt(campaignId);
    const [implementation, count] = await readCells([
      Mission.getPath({ type: 'Definition', campaign }),
      Mission.getPath({ type: 'DefinitionCount', campaign })
    ]);
    if (implementation === '0' || count === '0') return null;
    const missionCount = Number(count);
    if (!Number.isSafeInteger(missionCount) || missionCount > 0xffffffff) {
      throw new Error('Invalid indexed mission count');
    }
    return { campaign, implementation, missionCount };
  }

  static async getSubject(campaignId, subject, page = 0) {
    const definition = await this.getCampaign(campaignId);
    if (!definition) return null;
    const { campaign, missionCount } = definition;
    const [word] = await readCells([Mission.getPath({ type: 'Lifecycle', campaign, subject, page })]);
    const start = page * 32;
    const missions = Array.from({ length: Math.max(0, Math.min(32, missionCount - start)) }, (_, offset) => {
      const mission = start + offset;
      return { mission, ...Mission.unpackLifecycle(word, mission) };
    });
    return {
      ...definition,
      subject: jsonSafe(subject),
      subjectUuid: subjectUuid(subject),
      page,
      pageSize: 32,
      missions
    };
  }

  static async getEvidence(campaignId, subject, page, pageSize) {
    const definition = await this.getCampaign(campaignId);
    if (!definition) return null;
    const filter = { campaign: definition.campaign, subjectUuid: subjectUuid(subject), namespace: 'Evidence' };
    const [cells, total] = await Promise.all([
      model().find(filter).sort({ slotOrder: 1 }).skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      model().countDocuments(filter)
    ]);
    return {
      campaign: definition.campaign,
      subject: jsonSafe(subject),
      page,
      pageSize,
      total,
      cells: cells.map(({ path, slot, value }) => ({ path, slot, value }))
    };
  }

  static async getStarter(crewId) {
    const subject = { label: Entity.IDS.CREW, id: crewId };
    const uuid = subjectUuid(subject);
    const constants = await ConstantService.getConstants(['STARTER_MISSION_CAMPAIGN', 'STARTER_MISSION_CUTOFF']);
    const config = Object.fromEntries(constants.map(({ name, value }) => [name, felt(value)]));
    const campaign = config.STARTER_MISSION_CAMPAIGN || '0';
    const cutoff = config.STARTER_MISSION_CUTOFF ?? null;
    const [crew, state, eligibilityCells] = await Promise.all([
      mongoose.model('CrewComponent').findOne({ 'entity.uuid': uuid }).lean(),
      campaign !== '0' ? this.getSubject(campaign, subject) : null,
      readCells([StarterMission.getInvalidPath(crewId), StarterMission.getParticipatedPath(crewId)])
    ]);
    const [invalidated, participated] = eligibilityCells.map((value) => value !== '0');
    const active = campaign !== '0' && cutoff !== null && state?.missionCount === 8;
    const eligible = active && StarterMission.isEligible({
      campaign, cutoff, crewId, roster: crew?.roster || [], invalidated
    });
    const result = {
      campaign: campaign === '0' ? null : campaign,
      cutoff,
      active: Boolean(active),
      subject,
      subjectUuid: uuid,
      eligible: Boolean(eligible),
      participated,
      invalidated,
      recipient: crew?.delegatedTo || null,
      missions: [],
      progress: null
    };
    if (!active) return result;

    const assignment = { campaign, subject };
    const slots = [StarterMission.EVIDENCE_SLOTS.PROGRESS, StarterMission.EVIDENCE_SLOTS.WAREHOUSE];
    const [[progressWord, warehouse], productCells] = await Promise.all([
      readCells(slots.map((slot) => Mission.getEvidencePath(assignment, slot))),
      model().find({
        namespace: 'Evidence',
        campaign,
        subjectUuid: uuid,
        slotOrder: {
          $gte: slotOrder(StarterMission.EVIDENCE_SLOTS.FINAL_PRODUCTS),
          $lte: slotOrder(StarterMission.getFinalProductSlot(2n ** 64n - 1n))
        }
      }).sort({ slotOrder: 1 }).lean()
    ]);
    const progress = StarterMission.unpackProgress(progressWord);
    result.progress = {
      ...progress,
      warehouseId: warehouse === '0' ? null : warehouse,
      finalProductIds: productCells.flatMap(({ value, slot }) => (
        StarterMission.unpackFinalProducts(value, slot).map(String)
      ))
    };
    result.missions = state.missions.map((lifecycle) => {
      const definition = StarterMission.TYPES[lifecycle.mission];
      return {
        ...definition,
        ...lifecycle,
        earned: progress.earned[lifecycle.mission],
        rewardMicroSway: StarterMission.getRewardAmount(lifecycle.mission).toString(),
        canAccept: Boolean(eligible && !lifecycle.accepted
          && (definition.prerequisiteId === null || state.missions[definition.prerequisiteId].completed)),
        // Eligibility changes cannot revoke already completed reward entitlements.
        claimable: lifecycle.accepted && lifecycle.completed && !lifecycle.claimed
      };
    });
    return result;
  }
}

module.exports = MissionService;
