const { Asteroid, Building, Entity, Lot, Permission, Station } = require('@influenceth/sdk');
const { EntityService, LocationComponentService, ComponentService } = require('@common/services');
const EntityLib = require('@common/lib/Entity');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const CrewValidator = require('../../validators/crew');
const { ValidationError } = require('../../errors');

class CrewStationHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'CrewStationed'; }

  async validate() {
    const { destination: destRef, caller_crew: callerCrewRef } = this.vars || {};
    if (!callerCrewRef?.id) throw new ValidationError('vars.caller_crew with id is required');
    if (!destRef?.id || !destRef?.label) throw new ValidationError('vars.destination with id and label is required');

    // 1. Crew must exist and be controlled by this address
    this.crew = await EntityService.getEntity({
      id: callerCrewRef.id,
      label: Entity.IDS.CREW,
      components: ['Crew', 'Location', 'Control'],
      format: true
    });
    if (!this.crew) throw new ValidationError('Crew not found');
    await AccessValidator.assertControlledBy(this.crew, this.address);

    // 2. Crew must be ready
    CrewValidator.assertReady(this.crew);

    // 3. Destination must exist
    this.destination = await EntityService.getEntity({
      id: destRef.id,
      label: destRef.label,
      components: ['Location', 'Control'],
      format: true
    });
    if (!this.destination) throw new ValidationError('Destination not found');

    // 4. If destination is a building, verify it is operational
    if (destRef.label === Entity.IDS.BUILDING) {
      const building = await ComponentService.findOneByEntity('Building', {
        id: destRef.id,
        label: destRef.label
      });
      if (!building || building.status !== Building.CONSTRUCTION_STATUSES.OPERATIONAL) {
        throw new ValidationError('Destination building is not operational');
      }
    }

    // 5. Crew must be on or near an asteroid (not in transit between asteroids)
    const crewLocations = this.crew.Location?.locations || [];
    const crewAsteroid = crewLocations.find((l) => l.label === Entity.IDS.ASTEROID);
    if (!crewAsteroid) {
      throw new ValidationError('Crew must be on the surface to station (not in orbit)');
    }

    // 6. Destination must be on the same asteroid
    const destLocations = this.destination.Location?.locations || [];
    const destAsteroid = destLocations.find((l) => l.label === Entity.IDS.ASTEROID);
    if (!crewAsteroid || !destAsteroid || crewAsteroid.id !== destAsteroid.id) {
      throw new ValidationError('Crew and destination must be on the same asteroid');
    }

    // 7. Must have STATION_CREW permission on the destination
    await AccessValidator.assertPermission(this.crew, this.destination, Permission.IDS.STATION_CREW);

    // 8. Station capacity check
    const destStation = await ComponentService.findOneByEntity('Station', {
      id: destRef.id,
      label: destRef.label
    });
    if (destStation) {
      const stationConfig = Station.TYPES[destStation.stationType];
      if (stationConfig && destStation.population >= stationConfig.cap) {
        throw new ValidationError('Station is at capacity');
      }
    }

    // 9. Capture origin station from crew's current location
    this.originStation = this.crew.Location?.location || null;
  }

  async applyStateChanges() {
    this.now = Math.floor(Date.now() / 1000);
    const destRef = this.vars.destination;
    const destEntity = EntityLib.toEntity(destRef);
    const fullLocation = await LocationComponentService.getFullLocation(destEntity);

    // Update crew's location to the destination
    await this.writeComponent('Location', {
      entity: { id: this.crew.id, label: Entity.IDS.CREW },
      location: destEntity.toObject(),
      locations: fullLocation
    });

    // Compute travel time based on lot distance on the same asteroid
    this.finishTime = 0;
    const originLocations = this.crew.Location?.locations || [];
    const originLot = originLocations.find((l) => l.label === Entity.IDS.LOT);
    const originAsteroid = originLocations.find((l) => l.label === Entity.IDS.ASTEROID);
    const destLot = fullLocation.find((l) => l.label === Entity.IDS.LOT);
    const destAsteroid = fullLocation.find((l) => l.label === Entity.IDS.ASTEROID);

    if (originLot && destLot && originAsteroid && destAsteroid
      && originAsteroid.id === destAsteroid.id) {
      const originLotIndex = Lot.toPosition(originLot.id)?.lotIndex;
      const destLotIndex = Lot.toPosition(destLot.id)?.lotIndex;
      if (originLotIndex != null && destLotIndex != null) {
        const travelGameSeconds = Asteroid.getLotTravelTime(
          originAsteroid.id, originLotIndex, destLotIndex
        );
        if (travelGameSeconds > 0) {
          const travelTime = await this.gameSecondsToReal(travelGameSeconds);
          this.finishTime = this.now + travelTime;
          await this.setCrewBusy(this.crew, this.finishTime);
        }
      }
    }

    // Update station population: increment destination, decrement origin
    const rosterLen = (this.crew.Crew?.roster || []).length;
    if (rosterLen > 0) {
      // Increment destination station population
      const destStation = await ComponentService.findOneByEntity('Station', destEntity);
      if (destStation) {
        await this.writeComponent('Station', {
          entity: destEntity.toObject ? destEntity.toObject() : destEntity,
          population: destStation.population + rosterLen,
          stationType: destStation.stationType
        }, { replace: false });
      }

      // Decrement origin station population
      const originLoc = this.crew.Location?.location;
      if (originLoc) {
        const originStation = await ComponentService.findOneByEntity('Station', {
          id: originLoc.id,
          label: originLoc.label
        });
        if (originStation && originStation.population > 0) {
          await this.writeComponent('Station', {
            entity: { id: originLoc.id, label: originLoc.label },
            population: Math.max(0, originStation.population - rosterLen),
            stationType: originStation.stationType
          }, { replace: false });
        }
      }
    }

    return { crewId: this.crew.id };
  }

  getReturnValues() {
    return {
      station: this.vars.destination,
      originStation: this.originStation || { id: 0, label: 0 },
      destinationStation: this.vars.destination,
      finishTime: this.finishTime,
      callerCrew: this.vars.caller_crew,
      caller: this.address
    };
  }

  // eslint-disable-next-line class-methods-use-this
  getDispatcherSystemHandler() {
    // eslint-disable-next-line global-require
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/CrewStationed/v1');
  }
}

module.exports = CrewStationHandler;
