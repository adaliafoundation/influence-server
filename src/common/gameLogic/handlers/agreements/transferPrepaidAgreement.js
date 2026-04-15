const { Entity } = require('@influenceth/sdk');
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

    this.rate = this.existingAgreement?.rate || 0;
    this.initialTerm = this.existingAgreement?.initialTerm || 0;
    this.noticePeriod = this.existingAgreement?.noticePeriod || 0;
    this.term = this.existingAgreement?.endTime || 0;
  }

  async applyStateChanges() {
    // The dispatcher side-effect handler marks the old agreement as TRANSFERRED
    // and the component event creates a new agreement for the new permitted entity
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
