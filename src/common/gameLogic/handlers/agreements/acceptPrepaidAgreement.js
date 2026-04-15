const { Entity } = require('@influenceth/sdk');
const { EntityService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const { ValidationError } = require('../../errors');

class AcceptPrepaidAgreementHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'PrepaidAgreementAccepted'; }

  async validate() {
    const {
      target: targetRef, permission,
      permitted: permittedRef,
      caller_crew: callerCrewRef
    } = this.vars || {};
    if (!callerCrewRef?.id) throw new ValidationError('vars.caller_crew with id is required');
    if (!targetRef?.id || !targetRef?.label) throw new ValidationError('vars.target with id and label is required');
    if (!permission) throw new ValidationError('vars.permission is required');

    this.crew = await EntityService.getEntity({
      id: callerCrewRef.id,
      label: Entity.IDS.CREW,
      components: ['Crew', 'Location', 'Control'],
      format: true
    });
    if (!this.crew) throw new ValidationError('Crew not found');
    await AccessValidator.assertControlledBy(this.crew, this.address);

    // Load target to read its prepaid policy terms
    this.target = await EntityService.getEntity({
      id: targetRef.id,
      label: targetRef.label,
      components: ['PrepaidPolicies'],
      format: true
    });

    this.permission = Number(permission);
    this.permitted = permittedRef || this.vars.caller_crew;
    this.now = Math.floor(Date.now() / 1000);

    // Read policy terms from the target entity
    const policy = this.target?.PrepaidPolicies?.[this.permission];
    this.rate = policy?.rate || 0;
    this.initialTerm = policy?.initialTerm || 0;
    this.noticePeriod = policy?.noticePeriod || 0;
    this.term = this.now + (this.initialTerm || 86400 * 30); // default 30 days
  }

  async applyStateChanges() {
    // Write the PrepaidAgreement component
    await this.writeComponent('PrepaidAgreement', {
      entity: this.vars.target,
      permission: this.permission,
      permitted: this.permitted,
      rate: this.rate,
      initialTerm: this.initialTerm,
      noticePeriod: this.noticePeriod,
      startTime: this.now,
      endTime: this.term,
      noticeTime: 0
    });

    return {};
  }

  getReturnValues() {
    return {
      target: this.vars.target,
      permission: this.permission,
      permitted: this.permitted,
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
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/agreements/PrepaidAgreementAccepted');
  }
}

module.exports = AcceptPrepaidAgreementHandler;
