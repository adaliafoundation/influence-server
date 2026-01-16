const { Address } = require('@influenceth/sdk');
const logger = require('@common/lib/logger');
const Entity = require('@common/lib/Entity');
const { getPurchasePrice } = require('@common/lib/Asteroid');
const { ActivityService, ComponentService, ReferralService } = require('@common/services');
const StarknetBaseHandler = require('../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x3b181ce5ed73ba6f91c99195cbb820bb872d2ca91942f10c773b9f1011e43fe'],
    name: 'AsteroidPurchased'
  };

  async processEvent() {
    const { returnValues: { asteroid, callerCrew, caller } } = this.eventDoc;

    const activityResult = await ActivityService.findOrCreateOne({
      addresses: [caller],
      entities: [asteroid, callerCrew],
      event: this.eventDoc
    });
    if (activityResult?.created === 0) return;

    if (callerCrew) this.messages.push({ to: `Crew::${callerCrew.id}` });

    // Create referral document
    // Note: This will only create a new referral if one does not already exist
    try {
      await ReferralService.createReferralForBuyer(caller, Entity.Asteroid(asteroid.id));
    } catch (error) {
      logger.warn(`Error creating referral for buyer: ${error.message}`);
    }

    // Create (only) an InternalSale component for the asteroid
    try {
      const asteroidPurchasePrice = await getPurchasePrice(asteroid.id);

      await ComponentService.createOnlyFromEvent({
        component: 'InternalSale',
        event: this.eventDoc,
        data: {
          entity: Entity.Asteroid(asteroid.id),
          price: asteroidPurchasePrice
        }
      });
    } catch (error) {
      logger.warn(`Error creating InternalSale component: ${error.message}`);
    }
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      asteroid: this._entityFromData(data),
      callerCrew: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
