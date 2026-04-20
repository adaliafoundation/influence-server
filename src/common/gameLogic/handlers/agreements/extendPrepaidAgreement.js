const { Address, Entity } = require('@influenceth/sdk');
const { ComponentService, EntityService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const { ValidationError } = require('../../errors');
const Sway = require('../../helpers/sway');

class ExtendPrepaidAgreementHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'PrepaidAgreementExtended'; }

  async validate() {
    const {
      target: targetRef, permission,
      permitted: permittedRef,
      added_term: addedTerm,
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
    this.addedTerm = Number(addedTerm) || 0;

    // Find the existing agreement to get current terms
    this.existingAgreement = await ComponentService.findOne('PrepaidAgreement', {
      'entity.id': targetRef.id,
      permission: this.permission,
      'permitted.id': this.permitted.id
    });

    this.rate = this.existingAgreement?.rate || 0;
    this.initialTerm = this.existingAgreement?.initialTerm || 0;
    this.noticePeriod = this.existingAgreement?.noticePeriod || 0;
    this.term = (this.existingAgreement?.endTime || Math.floor(Date.now() / 1000)) + this.addedTerm;
  }

  async applyStateChanges() {
    if (!this.existingAgreement) return {};

    // SWAY: tenant pays for the extension. Same unit conversion as accept
    // (rate = microSWAY/hour, term = seconds → wei = rate × 1e12 × sec / 3600).
    const costWei = Sway.leaseCostWei({
      ratePerHourMicroSway: this.rate,
      seconds: this.addedTerm
    });
    if (costWei > 0n) {
      const control = await ComponentService.findOneByEntity('Control', this.vars.target);
      const lessorAddress = await Sway.addressOfCrew(control?.controller);
      if (!lessorAddress) throw new ValidationError('Lessor wallet not found for target');
      await Sway.transfer({
        fromAddress: Address.toStandard(this.address),
        toAddress: lessorAddress,
        amountWei: costWei
      });
    }

    await this.writeComponent('PrepaidAgreement', {
      entity: this.vars.target,
      permission: this.permission,
      permitted: this.permitted,
      rate: this.rate,
      initialTerm: this.initialTerm,
      noticePeriod: this.noticePeriod,
      startTime: this.existingAgreement.startTime,
      endTime: this.term,
      noticeTime: this.existingAgreement.noticeTime || 0
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
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/agreements/PrepaidAgreementExtended');
  }
}

module.exports = ExtendPrepaidAgreementHandler;
