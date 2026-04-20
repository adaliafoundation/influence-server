const { Entity } = require('@influenceth/sdk');
const { ComponentService, EntityService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const { ValidationError } = require('../../errors');

class PurchaseDepositHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'DepositPurchasedV1'; }

  async validate() {
    const { deposit: depositRef, caller_crew: callerCrewRef } = this.vars || {};
    if (!callerCrewRef?.id) throw new ValidationError('vars.caller_crew with id is required');
    if (!depositRef?.id) throw new ValidationError('vars.deposit with id is required');

    this.crew = await EntityService.getEntity({
      id: callerCrewRef.id,
      label: Entity.IDS.CREW,
      components: ['Crew', 'Location', 'Control'],
      format: true
    });
    if (!this.crew) throw new ValidationError('Crew not found');
    await AccessValidator.assertControlledBy(this.crew, this.address);

    this.deposit = { id: depositRef.id, label: Entity.IDS.DEPOSIT };

    // Look up the current sale listing to get price and seller
    const sale = await ComponentService.findOne('PrivateSale', {
      'entity.id': depositRef.id,
      'entity.label': Entity.IDS.DEPOSIT
    });
    this.price = sale?.amount || 0;

    // Find the seller crew (current controller of the deposit)
    const control = await ComponentService.findOne('Control', {
      'entity.id': depositRef.id,
      'entity.label': Entity.IDS.DEPOSIT
    });
    this.sellerCrew = control?.controller || { id: 0, label: Entity.IDS.CREW };
  }

  async applyStateChanges() {
    // Mark the sale as completed
    await this.writeComponent('PrivateSale', {
      entity: this.deposit,
      status: 0,
      amount: 0
    });
    return {};
  }

  getReturnValues() {
    return {
      deposit: this.deposit,
      price: this.price,
      sellerCrew: this.sellerCrew,
      callerCrew: this.vars.caller_crew,
      caller: this.address
    };
  }

  // eslint-disable-next-line class-methods-use-this
  getDispatcherSystemHandler() {
    // eslint-disable-next-line global-require
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/DepositPurchased/v1');
  }
}

module.exports = PurchaseDepositHandler;
