const { Address, Entity } = require('@influenceth/sdk');
const { ComponentService, EntityService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const { ValidationError } = require('../../errors');
const Sway = require('../../helpers/sway');

class AcceptPrepaidAgreementHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'PrepaidAgreementAccepted'; }

  async validate() {
    const {
      target: targetRef, permission,
      permitted: permittedRef,
      term, // seconds — set by the client based on what the tenant chose
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

    this.permission = Number(permission);
    this.permitted = permittedRef || this.vars.caller_crew;
    this.now = Math.floor(Date.now() / 1000);

    // Look up the active PrepaidPolicy for this permission. Direct query on
    // the component is more reliable than walking the formatted entity —
    // the target could be a lot, building, asteroid, etc. and the format
    // doesn't always include the PrepaidPolicy array.
    const policy = await ComponentService.findOne('PrepaidPolicy', {
      'entity.id': targetRef.id,
      'entity.label': targetRef.label,
      permission: this.permission
    });
    if (!policy) throw new ValidationError('No prepaid policy for this target+permission');

    this.rate = policy.rate || 0;
    this.initialTerm = policy.initialTerm || 0;
    this.noticePeriod = policy.noticePeriod || 0;

    // The client sends `term` (the length the tenant wants to lease, in
    // seconds). Cairo requires term >= initialTerm. Fall back to the
    // policy's initialTerm if the client omits it entirely.
    const requestedTerm = Number(term) || 0;
    this.leaseSeconds = Math.max(requestedTerm, this.initialTerm);
    if (this.leaseSeconds <= 0) {
      throw new ValidationError('Lease term must be positive');
    }
    this.term = this.now + this.leaseSeconds;
  }

  async applyStateChanges() {
    // SWAY: tenant pays the lessor up front for the lease term. The stored
    // `rate` is in micro-SWAY per HOUR (what the client sends), so the wei
    // cost is `rate × 1e12 × seconds / 3600`.
    const costWei = Sway.leaseCostWei({
      ratePerHourMicroSway: this.rate,
      seconds: this.leaseSeconds
    });
    if (costWei > 0n) {
      const lessorAddress = await this._resolveLessorAddress();
      if (!lessorAddress) throw new ValidationError('Lessor wallet not found for target');
      await Sway.transfer({
        fromAddress: Address.toStandard(this.address),
        toAddress: lessorAddress,
        amountWei: costWei
      });
    }

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

  /**
   * Walk target → Control.controller → Nft.owners.starknet to find the
   * wallet that receives the lease payment. Controller lives on the target
   * for buildings/ships/deposits/lots.
   */
  async _resolveLessorAddress() {
    const control = await ComponentService.findOneByEntity('Control', this.vars.target);
    const controller = control?.controller;
    if (!controller) return null;
    return Sway.addressOfCrew(controller);
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
