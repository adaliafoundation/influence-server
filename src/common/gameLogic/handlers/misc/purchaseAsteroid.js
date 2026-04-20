const { Address, Entity } = require('@influenceth/sdk');
const EntityLib = require('@common/lib/Entity');
const { ComponentService, EntityService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const { ValidationError } = require('../../errors');
const Sway = require('../../helpers/sway');

// Base price per km of radius in wei. Cairo reads this from an on-chain
// `ASTEROID_PURCHASE_BASE_PRICE` constant; in hybrid we default to a
// reasonable starter (1 SWAY per km) and let ops override via the
// Constant collection.
const DEFAULT_ASTEROID_BASE_PRICE_WEI_PER_KM = 1000000000000000000n;

class PurchaseAsteroidHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'AsteroidPurchased'; }

  async validate() {
    const { asteroid: asteroidRef, caller_crew: callerCrewRef } = this.vars || {};
    if (!callerCrewRef?.id) throw new ValidationError('vars.caller_crew with id is required');
    if (!asteroidRef?.id) throw new ValidationError('vars.asteroid with id is required');

    this.crew = await EntityService.getEntity({
      id: callerCrewRef.id,
      label: Entity.IDS.CREW,
      components: ['Crew', 'Location', 'Control'],
      format: true
    });
    if (!this.crew) throw new ValidationError('Crew not found');
    await AccessValidator.assertControlledBy(this.crew, this.address);

    this.asteroid = { id: asteroidRef.id, label: Entity.IDS.ASTEROID };

    // The asteroid must exist and currently be unowned (no Nft component
    // or Nft.owners.starknet unset). Cairo relies on Starknet token
    // uniqueness here — we emulate by checking ourselves.
    const asteroidNft = await ComponentService.findOneByEntity('Nft', this.asteroid);
    if (asteroidNft?.owners?.starknet) {
      throw new ValidationError('Asteroid is already owned');
    }

    // Need the Celestial record to price the sale.
    this.celestial = await ComponentService.findOneByEntity('Celestial', this.asteroid);
    if (!this.celestial) throw new ValidationError('Asteroid has no Celestial data');
  }

  async applyStateChanges() {
    // Price = base × radius (in km). Cairo uses a more complex formula;
    // linear is enough for hybrid sandboxes and is easy to reason about.
    const basePrice = await this._basePriceWei();
    const priceWei = basePrice * BigInt(Math.max(1, Math.floor(this.celestial.radius || 1)));
    if (priceWei > 0n) {
      // Debit without crediting anyone — matches Cairo's "send to
      // receivables account" in that the SWAY leaves circulation.
      await Sway.debit(Address.toStandard(this.address), priceWei);
    }

    // Mint the NFT to the caller.
    await this.writeComponent('Nft', {
      entity: this.asteroid,
      owners: { starknet: Address.toStandard(this.address) }
    });

    // Transfer control to the purchasing crew.
    await this.writeComponent('Control', {
      entity: this.asteroid,
      controller: EntityLib.toEntity(this.vars.caller_crew).toObject()
    });

    this.priceWei = priceWei;
    return { priceWei: priceWei.toString() };
  }

  async _basePriceWei() {
    const mongoose = require('mongoose'); // eslint-disable-line global-require
    const constant = await mongoose.model('Constant')
      .findOne({ name: 'ASTEROID_PURCHASE_BASE_PRICE' }).lean();
    if (constant?.value) {
      try { return BigInt(constant.value); } catch (e) { /* fall through */ }
    }
    return DEFAULT_ASTEROID_BASE_PRICE_WEI_PER_KM;
  }

  getReturnValues() {
    return {
      asteroid: this.asteroid,
      callerCrew: this.vars.caller_crew,
      caller: this.address
    };
  }

  // eslint-disable-next-line class-methods-use-this
  getDispatcherSystemHandler() {
    // eslint-disable-next-line global-require
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/AsteroidPurchased');
  }
}

module.exports = PurchaseAsteroidHandler;
