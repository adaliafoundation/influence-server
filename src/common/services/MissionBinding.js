const mongoose = require('mongoose');
const { Mission, StarterMission, Processor } = require('@influenceth/sdk');
const { bindingTypes, decodeComponent } = require('@common/lib/missionBindings');
const { felt, pathKey, subjectUuid } = require('@common/lib/missions');
const MissionService = require('./Mission');

class MissionBindingService {
  static async getBinding(campaignId, subject, kind, entity, slot) {
    const campaign = await MissionService.getCampaign(campaignId);
    if (!campaign) return null;
    const type = bindingTypes[kind];
    const evidenceSlot = StarterMission.getActionEvidenceSlot({ kind, entity, slot });
    const path = Mission.getEvidencePath({ campaign: campaign.campaign, subject }, evidenceSlot);
    const relatedKind = { Process: 'Downstream', Delivery: 'EconomicDelivery' }[kind];
    const relatedPath = relatedKind && Mission.getEvidencePath(
      { campaign: campaign.campaign, subject },
      StarterMission.getActionEvidenceSlot({ kind: relatedKind, entity, slot })
    );
    const cells = await mongoose.model('MissionComponent').find({
      pathKey: { $in: [path, ...(relatedPath ? [relatedPath] : [])].map(pathKey) }
    }).lean();
    const evidence = cells.find((cell) => cell.pathKey === pathKey(path));
    const related = relatedPath && cells.find((cell) => cell.pathKey === pathKey(relatedPath));
    const result = {
      campaign: campaign.campaign,
      subject,
      kind,
      entity,
      slot: String(slot),
      evidenceSlot: evidenceSlot.toString(),
      value: evidence?.value || '0',
      expectedValue: null,
      status: 'unbound',
      reason: null,
      evidenceEventId: evidence?.event?.id?.toString() || null,
      componentEventId: null,
      ...(relatedKind ? { relatedEvidence: { kind: relatedKind, value: related?.value || '0' } } : {})
    };
    if (result.value === '0') return result;

    const unknown = (reason) => ({ ...result, status: 'unknown', reason });
    const component = await mongoose.model(`${type.component}Component`).findOne({
      'entity.uuid': subjectUuid(entity),
      ...(type.slotted ? { slot: Number(slot) } : {})
    }).lean();
    if (!component) return unknown('component_not_indexed');
    result.componentEventId = component.event?.id?.toString() || null;
    const event = component.event?.id && await mongoose.model('Starknet').findById(component.event.id).lean();
    if (!event || event.removed || !event.data?.length) return unknown('source_event_unavailable');
    const expectedName = type.component === 'Processor' ? 'ComponentUpdated_Processor_V1'
      : `ComponentUpdated_${type.component}`;
    if (event.event !== expectedName) return unknown('unsupported_component_version');
    const { path: componentPath, data } = decodeComponent(type.component, event);
    if (componentPath[0] !== felt(subjectUuid(entity))
      || (type.slotted && componentPath[1] !== String(slot))) throw new Error('Component source path mismatch');

    // Completion resets Processor before its mission evidence is cleared. Never hash that reset state.
    if (kind === 'Process' && Number(data.status) !== Processor.STATUSES.RUNNING) {
      return unknown('processor_not_running');
    }

    let expected;
    if (kind === 'Built') {
      expected = StarterMission[type.helper](entity, data);
    } else {
      expected = StarterMission[type.helper](data);
    }
    result.expectedValue = expected.toString();
    result.status = result.value === result.expectedValue ? 'matched' : 'mismatched';
    return result;
  }
}

module.exports = MissionBindingService;
