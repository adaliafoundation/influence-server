const { Entity } = require('@influenceth/sdk');
const EntityLib = require('@common/lib/Entity');
const { ComponentService, EntityService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const { ValidationError } = require('../../errors');

class TransferPrepaidAgreementHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'PrepaidAgreementTransferred'; }

  async validate() {
    const {
      target: targetRef, permission,
      permitted: permittedRef, new_permitted: newPermittedRef,
      caller_crew: callerCrewRef
    } = this.vars || {};
    if (!callerCrewRef?.id) throw new ValidationError('vars.caller_crew with id is required');
    if (!targetRef?.id || !targetRef?.label) throw new ValidationError('vars.target with id and label is required');
    if (!permission) throw new ValidationError('vars.permission is required');
    if (!newPermittedRef?.id) throw new ValidationError('vars.new_permitted with id is required');

    this.crew = await EntityService.getEntity({
      id: callerCrewRef.id,
      label: Entity.IDS.CREW,
      components: ['Crew', 'Location', 'Control'],
      format: true
    });
    if (!this.crew) throw new ValidationError('Crew not found');
    await AccessValidator.assertControlledBy(this.crew, this.address);

    this.permission = Number(permission);
    this.oldPermitted = permittedRef || this.vars.caller_crew;
    this.newPermitted = newPermittedRef;

    // Find the existing agreement to get current terms
    this.existingAgreement = await ComponentService.findOne('PrepaidAgreement', {
      'entity.id': targetRef.id,
      permission: this.permission,
      'permitted.id': this.oldPermitted.id
    });
    if (!this.existingAgreement) throw new ValidationError('No active prepaid agreement to transfer');

    // Only the current permitted crew (or someone who controls it) may
    // transfer the lease. Matches Cairo transfer_prepaid.cairo:54
    // (`caller_crew == permitted.controller()`). Without this check any
    // crew could transfer someone else's lease to themselves or a third
    // party.
    const oldPermittedUuid = EntityLib.toEntity(this.oldPermitted).uuid;
    const callerUuid = EntityLib.toEntity(this.crew).uuid;
    if (oldPermittedUuid !== callerUuid) {
      // Allow the caller if they control the old_permitted entity (e.g.
      // delegated-to-wallet holds both crews). For simplicity we treat
      // "controls" as "both crews owned by the same wallet" — the access
      // validator's assertPermission already does this for a target, but
      // here the "target" is the tenant crew, so inline the check.
      const oldPermittedNft = await ComponentService.findOneByEntity('Nft', this.oldPermitted);
      const { Address } = require('@influenceth/sdk'); // eslint-disable-line global-require
      const tenantOwner = oldPermittedNft?.owners?.starknet || oldPermittedNft?.owners?.ethereum;
      if (!tenantOwner || Address.toStandard(tenantOwner) !== Address.toStandard(this.address)) {
        throw new ValidationError('Only the current tenant can transfer the lease');
      }
    }

    this.rate = this.existingAgreement.rate || 0;
    this.initialTerm = this.existingAgreement.initialTerm || 0;
    this.noticePeriod = this.existingAgreement.noticePeriod || 0;
    this.term = this.existingAgreement.endTime || 0;
  }

  async applyStateChanges() {
    // Actually perform the transfer: mark the old agreement TRANSFERRED
    // and write a fresh PrepaidAgreement for the new permitted crew with
    // the same terms / endTime. Was a no-op before; the dispatcher
    // handler doesn't write the new row.
    const existing = await ComponentService.findOne('PrepaidAgreement', {
      'entity.id': this.vars.target.id,
      permission: this.permission,
      'permitted.id': this.oldPermitted.id
    }, { lean: false });
    if (existing) {
      existing.status = 'TRANSFERRED';
      await existing.save();
    }

    await this.writeComponent('PrepaidAgreement', {
      entity: this.vars.target,
      permission: this.permission,
      permitted: this.newPermitted,
      rate: this.rate,
      initialTerm: this.initialTerm,
      noticePeriod: this.noticePeriod,
      startTime: this.existingAgreement.startTime || Math.floor(Date.now() / 1000),
      endTime: this.term,
      noticeTime: this.existingAgreement.noticeTime || 0
    });

    return {};
  }

  getReturnValues() {
    return {
      target: this.vars.target,
      permission: this.permission,
      permitted: this.newPermitted,
      oldPermitted: this.oldPermitted,
      term: this.term,
      rate: this.rate,
      initialTerm: this.initialTerm,
      noticePeriod: this.noticePeriod,
      callerCrew: this.vars.caller_crew,
      caller: this.address
    };
  }

  // eslint-disable-next-line class-methods-use-this
  getDispatcherSystemHandler() {
    // eslint-disable-next-line global-require
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/agreements/PrepaidAgreementTransferred');
  }
}

module.exports = TransferPrepaidAgreementHandler;
