const { Entity } = require('@influenceth/sdk');
const { ComponentService, EntityService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const { ValidationError } = require('../../errors');
const Sway = require('../../helpers/sway');

class CancelPrepaidAgreementHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'PrepaidAgreementCancelled'; }

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

    this.permission = Number(permission);
    this.permitted = permittedRef || this.vars.caller_crew;
    this.now = Math.floor(Date.now() / 1000);
    // In hybrid mode, eviction is immediate
    this.evictionTime = this.now;

    // Load the existing agreement so we can size the refund.
    this.existingAgreement = await ComponentService.findOne('PrepaidAgreement', {
      'entity.id': targetRef.id,
      'entity.label': targetRef.label,
      permission: this.permission,
      'permitted.id': this.permitted.id
    });
  }

  async applyStateChanges() {
    // SWAY refund: return the tenant's unused prepaid time.
    //   refundSeconds = max(0, endTime - now - noticePeriod)
    // Cairo only refunds the portion beyond the notice period; matches
    // here so a tenant who cancels mid-lease still owes the landlord for
    // the notice window they agreed to.
    if (this.existingAgreement && this.existingAgreement.rate > 0) {
      const endTime = this.existingAgreement.endTime || 0;
      const noticePeriod = this.existingAgreement.noticePeriod || 0;
      const refundSeconds = Math.max(0, endTime - this.now - noticePeriod);
      if (refundSeconds > 0) {
        const refundWei = Sway.leaseCostWei({
          ratePerHourMicroSway: this.existingAgreement.rate,
          seconds: refundSeconds
        });
        const control = await ComponentService.findOneByEntity('Control', this.vars.target);
        const lessorAddress = await Sway.addressOfCrew(control?.controller);
        const tenantAddress = await Sway.addressOfCrew(this.permitted);
        if (lessorAddress && tenantAddress) {
          await Sway.transfer({
            fromAddress: lessorAddress,
            toAddress: tenantAddress,
            amountWei: refundWei
          });
        }
      }
    }

    // The PrepaidAgreement.status flip to CANCELLED happens in the
    // Dispatcher side-effect handler (PrepaidAgreementCancelled).
    return {};
  }

  getReturnValues() {
    return {
      target: this.vars.target,
      permission: this.permission,
      permitted: this.permitted,
      evictionTime: this.evictionTime,
      callerCrew: this.vars.caller_crew,
      caller: this.address
    };
  }

  // eslint-disable-next-line class-methods-use-this
  getDispatcherSystemHandler() {
    // eslint-disable-next-line global-require
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/agreements/PrepaidAgreementCancelled');
  }
}

module.exports = CancelPrepaidAgreementHandler;
