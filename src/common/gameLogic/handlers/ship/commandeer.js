const { Address, Entity } = require('@influenceth/sdk');
const EntityLib = require('@common/lib/Entity');
const { ComponentService, EntityService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const CrewValidator = require('../../validators/crew');
const { ValidationError } = require('../../errors');

class ShipCommandeerHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'ShipCommandeered'; }

  async validate() {
    const { ship: shipRef, caller_crew: callerCrewRef } = this.vars || {};
    if (!callerCrewRef?.id) throw new ValidationError('vars.caller_crew with id is required');
    if (!shipRef?.id) throw new ValidationError('vars.ship with id is required');

    // 1. Crew must exist and be controlled by this address. Matches
    // Cairo commandeer_ship.cairo:37-38 — crew must be ready AND have
    // crewmates on board.
    this.crew = await EntityService.getEntity({
      id: callerCrewRef.id,
      label: Entity.IDS.CREW,
      components: ['Crew', 'Location', 'Control'],
      format: true
    });
    if (!this.crew) throw new ValidationError('Crew not found');
    await AccessValidator.assertControlledBy(this.crew, this.address);
    CrewValidator.assertReady(this.crew);
    CrewValidator.assertHasRoster(this.crew);

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

    // If the ship is in flight, the new crew inherits the arrival time —
    // they can't act before the ship reaches its destination. Cairo
    // commandeer_ship.cairo:48-51 does the same. Without this, a crew
    // can commandeer an in-transit ship and instantly take control of a
    // ship "at" its origin.
    const shipReadyAt = this.ship.Ship?.readyAt || 0;
    const now = Math.floor(Date.now() / 1000);
    if (shipReadyAt > now) {
      await this.setCrewBusy(this.crew, shipReadyAt);
    }

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
