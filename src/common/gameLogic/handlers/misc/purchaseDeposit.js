const { Address, Entity } = require('@influenceth/sdk');
const EntityLib = require('@common/lib/Entity');
const { ComponentService, EntityService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const { ValidationError } = require('../../errors');
const Sway = require('../../helpers/sway');

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

    // Must actually be listed for sale.
    const sale = await ComponentService.findOne('PrivateSale', {
      'entity.id': depositRef.id,
      'entity.label': Entity.IDS.DEPOSIT
    });
    if (!sale || sale.status !== 1) throw new ValidationError('Deposit is not listed for sale');
    this.price = sale.amount || 0;

    // Find the seller crew (current controller of the deposit).
    const control = await ComponentService.findOne('Control', {
      'entity.id': depositRef.id,
      'entity.label': Entity.IDS.DEPOSIT
    });
    this.sellerCrew = control?.controller;
    if (!this.sellerCrew) throw new ValidationError('Deposit has no controller');
    if (this.sellerCrew.id === this.crew.id) {
      throw new ValidationError('Cannot purchase your own deposit');
    }
  }

  async applyStateChanges() {
    // SWAY: buyer → seller. Price is stored in the sale's SWAY scale
    // (6-decimal microSWAY matching the client) → convert to wei via ×1e12.
    if (this.price > 0) {
      const priceWei = BigInt(this.price) * Sway.SCALE_PRICE_TO_WEI;
      const sellerAddress = await Sway.addressOfCrew(this.sellerCrew);
      if (!sellerAddress) throw new ValidationError('Seller wallet not found');
      await Sway.transfer({
        fromAddress: Address.toStandard(this.address),
        toAddress: sellerAddress,
        amountWei: priceWei
      });
    }

    // Transfer Control of the deposit to the buyer's crew. Without this,
    // the deposit's controller stays with the seller and the buyer can't
    // exercise USE_DEPOSIT when trying to extract.
    await this.writeComponent('Control', {
      entity: this.deposit,
      controller: EntityLib.toEntity(this.vars.caller_crew).toObject()
    });

    // Mark the sale as completed.
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
