const { Asteroid, Entity, Product, Ship, Time, GM_ADALIA } = require('@influenceth/sdk');
const { angles: astroAngles, elements: astroElements } = require('@influenceth/astro');
const EntityLib = require('@common/lib/Entity');
const { ComponentService, EntityService, LocationComponentService } = require('@common/services');
const BaseActionHandler = require('../BaseActionHandler');
const AccessValidator = require('../../validators/access');
const CrewValidator = require('../../validators/crew');
const { ValidationError } = require('../../errors');

const MU_KM = GM_ADALIA / 1e9; // km^3/s^2 (SDK stores GM in m^3/s^2)
const POSITION_TOLERANCE_KM = 578; // Cairo uses 578 km per-axis tolerance
const MAX_TRANSIT_GAME_SECONDS = 47304000; // ~1.5 years in game-seconds

class TransitStartHandler extends BaseActionHandler {
  // eslint-disable-next-line class-methods-use-this
  getEventName() { return 'TransitStarted'; }

  async validate() {
    const {
      origin: originRef,
      destination: destRef,
      departure_time: departureTime,
      arrival_time: arrivalTime,
      caller_crew: callerCrewRef
    } = this.vars || {};

    if (!callerCrewRef?.id) throw new ValidationError('vars.caller_crew with id is required');
    if (!destRef?.id || !destRef?.label) throw new ValidationError('vars.destination with id and label is required');
    if (!departureTime) throw new ValidationError('vars.departure_time is required');
    if (!arrivalTime) throw new ValidationError('vars.arrival_time is required');

    this.now = Math.floor(Date.now() / 1000);
    this.departureTime = Number(departureTime);
    this.arrivalTime = Number(arrivalTime);

    // Populate TIME_ACCELERATION (cached on this._timeAcceleration by base class)
    await this.gameSecondsToReal(1);
    const timeAccel = this._timeAcceleration;

    // ── 1. Crew checks ───────────────────────────────────────────────────

    this.crew = await EntityService.getEntity({
      id: callerCrewRef.id,
      label: Entity.IDS.CREW,
      components: ['Crew', 'Location', 'Control'],
      format: true
    });
    if (!this.crew) throw new ValidationError('Crew not found');
    await AccessValidator.assertControlledBy(this.crew, this.address);

    // Crew must be manned
    if (!this.crew.Crew?.roster || this.crew.Crew.roster.length === 0) {
      throw new ValidationError('Crew has no crewmates');
    }

    CrewValidator.assertReady(this.crew);

    // ── 2. Ship checks ───────────────────────────────────────────────────

    const crewLocation = this.crew.Location?.location;
    if (!crewLocation) throw new ValidationError('Crew has no location');

    if (this.vars.ship) {
      this.ship = await EntityService.getEntity({
        id: this.vars.ship.id,
        label: Entity.IDS.SHIP,
        components: ['Ship', 'Location', 'Control'],
        format: true
      });
    } else if (crewLocation.label === Entity.IDS.SHIP) {
      this.ship = await EntityService.getEntity({
        id: crewLocation.id,
        label: Entity.IDS.SHIP,
        components: ['Ship', 'Location', 'Control'],
        format: true
      });
    }
    if (!this.ship) throw new ValidationError('Ship not found');

    // Crew must control the ship
    const controller = this.ship.Control?.controller;
    if (!controller || controller.id !== this.crew.id || controller.label !== Entity.IDS.CREW) {
      throw new ValidationError('Crew does not control this ship');
    }

    // Ship must be AVAILABLE and ready
    if (this.ship.Ship.status !== Ship.STATUSES.AVAILABLE) {
      throw new ValidationError('Ship is not available');
    }
    if (this.ship.Ship.readyAt && this.ship.Ship.readyAt > this.now) {
      throw new ValidationError('Ship is not ready yet');
    }

    // Ship must be in orbit (not docked or landed)
    const shipLocation = this.ship.Location?.location;
    if (shipLocation && shipLocation.label === Entity.IDS.BUILDING) {
      throw new ValidationError('Ship is docked — undock before starting transit');
    }
    if (shipLocation && shipLocation.label === Entity.IDS.LOT) {
      throw new ValidationError('Ship is on the surface — launch before starting transit');
    }

    // ── 3. Location checks ───────────────────────────────────────────────

    this.origin = originRef || this.ship.Location?.location;
    if (!this.origin) throw new ValidationError('Could not determine origin');

    this.destination = destRef;

    // Ship must be at the origin asteroid
    const shipLocations = this.ship.Location?.locations || [];
    const shipAsteroid = shipLocations.find((l) => l.label === Entity.IDS.ASTEROID);
    if (!shipAsteroid || shipAsteroid.id !== this.origin.id) {
      throw new ValidationError('Ship is not at the origin asteroid');
    }

    // Destination must be surface-scanned
    const destCelestial = await ComponentService.findOneByEntity('Celestial', {
      id: this.destination.id, label: Entity.IDS.ASTEROID
    });
    if (!destCelestial || destCelestial.scanStatus < Asteroid.SCAN_STATUSES.SURFACE_SCANNED) {
      throw new ValidationError('Destination asteroid has not been surface scanned');
    }

    // ── 4. Inventory reservation checks ──────────────────────────────────

    this.shipConfig = Ship.TYPES[this.ship.Ship.shipType];
    const shipEntity = { id: this.ship.id, label: Entity.IDS.SHIP };
    this.inventories = await ComponentService.findByEntity('Inventory', shipEntity);

    for (const inv of this.inventories) {
      if ((inv.reservedMass || 0) + (inv.reservedVolume || 0) > 0) {
        throw new ValidationError('Ship has active delivery reservations');
      }
    }

    // ── 5. Time validation ───────────────────────────────────────────────

    const EPOCH = Time.ORBIT_ZERO_TIMESTAMP;
    const irlDeparture = EPOCH + Math.ceil(this.departureTime / timeAccel);
    const irlArrival = EPOCH + Math.ceil(this.arrivalTime / timeAccel);

    const crewReadyAt = this.crew.Crew.readyAt || 0;
    if (irlDeparture < crewReadyAt) {
      throw new ValidationError('Departure time is before crew is ready');
    }
    if (irlArrival <= irlDeparture) {
      throw new ValidationError('Arrival time must be after departure time');
    }

    // Transit duration limit (~1.5 years game time)
    const globalMaxReal = Math.floor(MAX_TRANSIT_GAME_SECONDS / timeAccel);
    if (irlArrival - irlDeparture > globalMaxReal) {
      throw new ValidationError('Transit duration exceeds maximum range');
    }

    // Food/starvation check (skip if ship is in emergency mode)
    if (!this.ship.Ship.emergencyAt) {
      const lastFed = Math.max(
        this.crew.Crew.lastFed || 0,
        EPOCH // at minimum, use orbit epoch as launch time stand-in
      );
      if (irlArrival > lastFed + globalMaxReal) {
        throw new ValidationError('Crew would starve during transit');
      }
    }

    // ── 6. Orbital trajectory validation ─────────────────────────────────

    await this._validateTransitOrbit();

    // ── 7. Propellant sufficiency ────────────────────────────────────────

    const propInv = this.inventories.find((i) => i.slot === this.shipConfig?.propellantSlot);
    const propProduct = this.shipConfig?.propellantType;
    const propellantAvailable = (propInv?.contents || [])
      .filter((c) => c.product === propProduct)
      .reduce((sum, c) => sum + c.amount, 0);

    this.usedPropellantUnits = Number(this.meta?.usedPropellantMass) || 0;
    if (this.usedPropellantUnits <= 0) {
      throw new ValidationError('Propellant usage not specified');
    }
    if (this.usedPropellantUnits > propellantAvailable) {
      throw new ValidationError('Insufficient propellant for this transit');
    }

    // Store IRL arrival for applyStateChanges
    this.irlArrival = irlArrival;
  }

  /**
   * Reproduce the Cairo orbital position validation:
   * 1. Compute origin asteroid position at departure_time
   * 2. Compute destination asteroid position at arrival_time
   * 3. Compute transit orbit positions at departure/arrival using client-provided elements
   * 4. Assert each pair is within 578 km per axis
   */
  async _validateTransitOrbit() {
    const {
      transit_p: tP, transit_ecc: tEcc, transit_inc: tInc,
      transit_raan: tRaan, transit_argp: tArgp,
      transit_nu_start: tNuStart, transit_nu_end: tNuEnd
    } = this.vars;

    // Need all transit orbital elements
    if (tP == null || tEcc == null || tInc == null ||
        tRaan == null || tArgp == null || tNuStart == null || tNuEnd == null) {
      throw new ValidationError('Missing transit orbital elements');
    }

    // Fetch orbit data for both asteroids
    const [originOrbit, destOrbit] = await Promise.all([
      ComponentService.findOneByEntity('Orbit', { id: this.origin.id, label: Entity.IDS.ASTEROID }),
      ComponentService.findOneByEntity('Orbit', { id: this.destination.id, label: Entity.IDS.ASTEROID })
    ]);
    if (!originOrbit) throw new ValidationError('Origin asteroid orbit data not found');
    if (!destOrbit) throw new ValidationError('Destination asteroid orbit data not found');

    // Compute origin position & velocity at departure
    const [rOrigin, vOrigin] = computePositionAtTime(originOrbit, this.departureTime);

    // Compute destination position & velocity at arrival
    const [rDest, vDest] = computePositionAtTime(destOrbit, this.arrivalTime);

    // Compute transit orbit position & velocity at departure (nu_start)
    const [rStart, vStart] = astroElements.coe2rv(MU_KM, tP, tEcc, tInc, tRaan, tArgp, tNuStart);

    // Compute transit orbit position & velocity at arrival (nu_end)
    const [rEnd, vEnd] = astroElements.coe2rv(MU_KM, tP, tEcc, tInc, tRaan, tArgp, tNuEnd);

    // Validate positions match within tolerance (per-axis, matching Cairo)
    assertPositionsClose(rOrigin, rStart, 'Transit departure position does not match origin asteroid');
    assertPositionsClose(rDest, rEnd, 'Transit arrival position does not match destination asteroid');
  }

  async applyStateChanges() {
    const shipEntity = { id: this.ship.id, label: Entity.IDS.SHIP };

    // Update ship transit data (use irlArrival as readyAt)
    await this.writeComponent('Ship', {
      entity: shipEntity,
      shipType: this.ship.Ship.shipType,
      status: this.ship.Ship.status,
      variant: this.ship.Ship.variant,
      readyAt: this.irlArrival,
      emergencyAt: this.ship.Ship.emergencyAt,
      transitDeparture: this.departureTime,
      transitArrival: this.arrivalTime,
      transitOrigin: this.origin,
      transitDestination: this.destination
    });

    // Consume propellant
    if (this.usedPropellantUnits > 0 && this.shipConfig?.propellantSlot) {
      const propInv = this.inventories.find((i) => i.slot === this.shipConfig.propellantSlot);
      if (propInv) {
        const propProduct = this.shipConfig.propellantType;
        const updatedContents = [...(propInv.contents || [])];
        const existing = updatedContents.find((c) => c.product === propProduct);
        if (existing) {
          existing.amount = Math.max(0, existing.amount - this.usedPropellantUnits);
          if (existing.amount === 0) {
            updatedContents.splice(updatedContents.indexOf(existing), 1);
          }
        }

        let newMass = 0;
        let newVolume = 0;
        for (const c of updatedContents) {
          const pt = Product.TYPES[c.product];
          if (pt) {
            newMass += c.amount * pt.massPerUnit;
            newVolume += c.amount * pt.volumePerUnit;
          }
        }

        await this.writeComponent('Inventory', {
          entity: shipEntity,
          inventoryType: propInv.inventoryType,
          slot: propInv.slot,
          status: propInv.status,
          mass: newMass,
          volume: newVolume,
          reservedMass: propInv.reservedMass || 0,
          reservedVolume: propInv.reservedVolume || 0,
          contents: updatedContents
        });
      }
    }

    // During transit the ship is "in space" — clear the location chain so the
    // client groups this crew under "In Flight" rather than an asteroid.
    // We bypass writeComponent because the Location preValidate hook auto-fills
    // locations from the location field and rejects empty/null locations.
    await ComponentService.model('Location').updateOne(
      { 'entity.id': shipEntity.id, 'entity.label': shipEntity.label },
      { $set: { location: null, locations: [] } }
    );

    // Mark crew as busy until arrival
    await this.setCrewBusy(this.crew, this.irlArrival);

    return { shipId: this.ship.id };
  }

  getReturnValues() {
    return {
      ship: { id: this.ship.id, label: Entity.IDS.SHIP },
      origin: this.origin,
      destination: this.destination,
      departure: this.departureTime,
      arrival: this.arrivalTime,
      finishTime: this.irlArrival,
      callerCrew: this.vars.caller_crew,
      caller: this.address
    };
  }

  // eslint-disable-next-line class-methods-use-this
  getDispatcherSystemHandler() {
    // eslint-disable-next-line global-require
    return require('@common/lib/events/handlers/starknet/Dispatcher/systems/TransitStarted');
  }
}

// ── Orbital helpers ────────────────────────────────────────────────────────

/**
 * Compute position [rx, ry, rz] and velocity [vx, vy, vz] (in km and km/s)
 * for an asteroid at a given time (in game-seconds since orbit epoch).
 */
function computePositionAtTime(orbit, gameSeconds) {
  const period = 2 * Math.PI * Math.sqrt(orbit.a ** 3 / MU_KM);
  const M = orbit.m + 2 * Math.PI * gameSeconds / period;
  const E = astroAngles.M_to_E(M, orbit.ecc);
  const nu = astroAngles.E_to_nu(E, orbit.ecc);
  const p = orbit.a * (1 - orbit.ecc ** 2);
  return astroElements.coe2rv(MU_KM, p, orbit.ecc, orbit.inc, orbit.raan, orbit.argp, nu);
}

/**
 * Assert two position vectors are within POSITION_TOLERANCE_KM per axis.
 * Mirrors the Cairo assert_positions_equal check.
 */
function assertPositionsClose(pos1, pos2, message) {
  for (let i = 0; i < 3; i++) {
    if (Math.abs(pos1[i] - pos2[i]) >= POSITION_TOLERANCE_KM) {
      throw new ValidationError(message);
    }
  }
}

module.exports = TransitStartHandler;
