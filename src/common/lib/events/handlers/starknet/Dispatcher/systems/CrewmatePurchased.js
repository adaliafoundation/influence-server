const { Address } = require('@influenceth/sdk');
const logger = require('@common/lib/logger');
const Entity = require('@common/lib/Entity');
const { getPurchasePrice } = require('@common/lib/Crewmate');
const { ActivityService, ComponentService, ReferralService } = require('@common/services');
const StarknetBaseHandler = require('../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x14013c248cb04a005ca138d1c858190cef324896e4b49464db60e132c9fe7f1'],
    name: 'CrewmatePurchased'
  };

  async processEvent() {
    const { returnValues: { crewmate, caller } } = this.eventDoc;

    const activityResult = await ActivityService.findOrCreateOne({
      addresses: [caller],
      entities: [crewmate],
      event: this.eventDoc
    });

    if (activityResult?.created === 0) return;

    this.messages.push({ to: caller });

    // Create referral document
    // Note: This will only create a new referral if one does not already exist
    try {
      await ReferralService.createReferralForBuyer(caller, Entity.Crewmate(crewmate.id));
    } catch (error) {
      logger.warn(`Error creating referral for buyer: ${error.message}`);
    }

    // Create (only) an InternalSale component for the crewmate
    try {
      const crewmatePurchasePrice = await getPurchasePrice(crewmate.id);

      await ComponentService.createOnlyFromEvent({
        component: 'InternalSale',
        event: this.eventDoc,
        data: {
          entity: Entity.Crewmate(crewmate.id),
          price: crewmatePurchasePrice
        }
      });
    } catch (error) {
      logger.warn(`Error creating InternalSale component: ${error.message}`);
    }
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      crewmate: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
