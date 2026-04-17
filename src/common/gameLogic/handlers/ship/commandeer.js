const { Address, Entity } = require('@influenceth/sdk');
const EntityLib = require('@common/lib/Entity');
const { ComponentService, EntityService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const { ValidationError } = require('../../errors');

class ShipCommandeerHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'ShipCommandeered'; }

  async validate() {
    const { ship: shipRef, caller_crew: callerCrewRef } = this.vars || {};
    if (!callerCrewRef?.id) throw new ValidationError('vars.caller_crew with id is required');
    if (!shipRef?.id) throw new ValidationError('vars.ship with id is required');

    // 1. Crew must exist and be controlled by this address
    this.crew = await EntityService.getEntity({
      id: callerCrewRef.id,
      label: Entity.IDS.CREW,
      components: ['Crew', 'Location', 'Control'],
      format: true
    });
    if (!this.crew) throw new ValidationError('Crew not found');
    await AccessValidator.assertControlledBy(this.crew, this.address);

    // 2. Ship must exist
    this.ship = await EntityService.getEntity({
      id: shipRef.id,
      label: Entity.IDS.SHIP,
      components: ['Ship', 'Location', 'Control'],
      format: true
    });
    if (!this.ship) throw new ValidationError('Ship not found');

    // 3. Caller must own the ship NFT
    const shipNft = await ComponentService.findOneByEntity('Nft', {
      id: this.ship.id,
      label: Entity.IDS.SHIP
    });
    if (!shipNft) throw new ValidationError('Ship NFT not found');
    const shipOwner = shipNft.owners?.starknet || shipNft.owners?.ethereum;
    if (!shipOwner || Address.toStandard(shipOwner) !== Address.toStandard(this.address)) {
      throw new ValidationError('Caller does not own this ship');
    }
  }

  async applyStateChanges() {
    // Transfer control of the ship to the caller crew
    await this.writeComponent('Control', {
      entity: { id: this.ship.id, label: Entity.IDS.SHIP },
      controller: EntityLib.toEntity(this.vars.caller_crew).toObject()
    });

    return { shipId: this.ship.id };
  }

  getReturnValues() {
    return {
      ship: { id: this.ship.id, label: Entity.IDS.SHIP },
      callerCrew: this.vars.caller_crew,
      caller: this.address
    };
  }

  // eslint-disable-next-line class-methods-use-this
  getDispatcherSystemHandler() {
    // eslint-disable-next-line global-require
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/ShipCommandeered');
  }
}

module.exports = ShipCommandeerHandler;
