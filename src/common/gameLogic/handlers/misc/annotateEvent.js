const { Entity } = require('@influenceth/sdk');
const { EntityService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const { ValidationError } = require('../../errors');

class AnnotateEventHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'EventAnnotated'; }

  async validate() {
    const {
      transaction_hash: txHash, log_index: logIndex,
      content_hash: contentHash, caller_crew: callerCrewRef
    } = this.vars || {};
    if (!callerCrewRef?.id) throw new ValidationError('vars.caller_crew with id is required');
    if (!txHash) throw new ValidationError('vars.transaction_hash is required');

    this.crew = await EntityService.getEntity({
      id: callerCrewRef.id,
      label: Entity.IDS.CREW,
      components: ['Crew', 'Location', 'Control'],
      format: true
    });
    if (!this.crew) throw new ValidationError('Crew not found');
    await AccessValidator.assertControlledBy(this.crew, this.address);

    this.transactionHash = txHash;
    this.logIndex = Number(logIndex || 0);
    // contentHash may be an array of shortstring chunks — join them
    this.contentHash = Array.isArray(contentHash) ? contentHash.join('') : (contentHash || '');
  }

  // eslint-disable-next-line class-methods-use-this
  async applyStateChanges() {
    return {};
  }

  getReturnValues() {
    return {
      transactionHash: this.transactionHash,
      logIndex: this.logIndex,
      contentHash: this.contentHash,
      callerCrew: this.vars.caller_crew,
      caller: this.address
    };
  }

  // eslint-disable-next-line class-methods-use-this
  getDispatcherSystemHandler() {
    // eslint-disable-next-line global-require
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/EventAnnotated');
  }
}

module.exports = AnnotateEventHandler;
