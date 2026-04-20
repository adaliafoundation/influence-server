const { Entity, Exchange } = require('@influenceth/sdk');
const { ComponentService, EntityService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const { ValidationError } = require('../../errors');

class ConfigureExchangeHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'ExchangeConfigured'; }

  async validate() {
    const {
      exchange: exchangeRef,
      maker_fee: makerFee, taker_fee: takerFee,
      allowed_products: allowedProducts,
      caller_crew: callerCrewRef
    } = this.vars || {};

    if (!callerCrewRef?.id) throw new ValidationError('vars.caller_crew with id is required');
    if (!exchangeRef?.id) throw new ValidationError('vars.exchange with id is required');

    // 1. Crew must exist and be controlled by this address
    this.crew = await EntityService.getEntity({
      id: callerCrewRef.id,
      label: Entity.IDS.CREW,
      components: ['Crew', 'Location', 'Control'],
      format: true
    });
    if (!this.crew) throw new ValidationError('Crew not found');
    await AccessValidator.assertControlledBy(this.crew, this.address);

    // 2. Exchange (building) must exist and be controlled by caller
    this.exchange = await EntityService.getEntity({
      id: exchangeRef.id,
      label: exchangeRef.label || Entity.IDS.BUILDING,
      components: ['Exchange', 'Control'],
      format: true
    });
    if (!this.exchange) throw new ValidationError('Exchange not found');

    this.makerFee = Number(makerFee) || 0;
    this.takerFee = Number(takerFee) || 0;
    this.allowedProducts = Array.isArray(allowedProducts) ? allowedProducts.map(Number) : [];

    // 3. Validate fee bounds (0–25%, stored as basis points × 100)
    if (this.makerFee < 0 || this.makerFee > 2500) {
      throw new ValidationError('Maker fee must be between 0 and 2500 (0–25%)');
    }
    if (this.takerFee < 0 || this.takerFee > 2500) {
      throw new ValidationError('Taker fee must be between 0 and 2500 (0–25%)');
    }

    // 4. Validate product cap
    const exchangeType = this.exchange.Exchange?.exchangeType || 1;
    const exchangeConfig = Exchange.TYPES[exchangeType];
    if (exchangeConfig && this.allowedProducts.length > exchangeConfig.productCap) {
      throw new ValidationError(`Too many products (max ${exchangeConfig.productCap})`);
    }

    // 5. Cannot remove a product that has open orders
    const currentProducts = this.exchange.Exchange?.allowedProducts || [];
    const removedProducts = currentProducts.filter((p) => !this.allowedProducts.includes(p));
    if (removedProducts.length > 0) {
      const exchangeEntity = { id: this.exchange.id, label: Entity.IDS.BUILDING };
      const openOrders = await ComponentService.model('Order').find({
        'entity.id': exchangeEntity.id,
        'entity.label': exchangeEntity.label,
        product: { $in: removedProducts },
        amount: { $gt: 0 }
      }).lean();
      if (openOrders.length > 0) {
        const products = [...new Set(openOrders.map((o) => o.product))];
        throw new ValidationError(`Cannot remove products with open orders: ${products.join(', ')}`);
      }
    }
  }

  async applyStateChanges() {
    await this.writeComponent('Exchange', {
      entity: { id: this.exchange.id, label: this.exchange.label || Entity.IDS.BUILDING },
      exchangeType: this.exchange.Exchange?.exchangeType || 1,
      makerFee: this.makerFee,
      takerFee: this.takerFee,
      allowedProducts: this.allowedProducts,
      orders: this.exchange.Exchange?.orders || 0
    });

    return {};
  }

  getReturnValues() {
    return {
      exchange: this.vars.exchange,
      callerCrew: this.vars.caller_crew,
      caller: this.address
    };
  }

  // eslint-disable-next-line class-methods-use-this
  getDispatcherSystemHandler() {
    // eslint-disable-next-line global-require
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/ExchangeConfigured');
  }
}

module.exports = ConfigureExchangeHandler;
