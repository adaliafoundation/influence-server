const { Asteroid, Entity, Lot } = require('@influenceth/sdk');
const { LocationComponentService } = require('@common/services');

/**
 * Hopper travel time (real-seconds) between two lot positions on the same
 * asteroid. Mirrors `position::hopper_travel_time` in the Cairo common
 * module — surface path at HOPPER_SPEED, with optional crew bonus multiplier.
 *
 * Returns 0 when either endpoint is orbit (lotIndex 0) or missing — matches
 * the simplified Cairo fallback: crews in orbit don't pay hopper time.
 */
function hopperTravelTime(asteroidId, originLotIndex, destLotIndex, bonus = 1) {
  if (!asteroidId || originLotIndex == null || destLotIndex == null) return 0;
  if (originLotIndex === 0 || destLotIndex === 0) return 0;
  if (originLotIndex === destLotIndex) return 0;
  const distance = Asteroid.getLotDistance(asteroidId, originLotIndex, destLotIndex);
  return Asteroid.getHopperTravelTime(distance, bonus);
}

/**
 * Resolve the crew's current lot + asteroid from a Location component and
 * return the hopper travel time (game-seconds) from there to the target lot.
 */
function crewToLotTravelTime(crew, targetLotEntity) {
  const loc = crew?.Location?.location;
  if (!loc) return 0;
  let crewLotId = 0;
  if (loc.label === Entity.IDS.LOT) crewLotId = loc.id;
  if (loc.label === Entity.IDS.BUILDING || loc.label === Entity.IDS.SHIP) {
    // Dig through the locations chain to find the lot under a building/ship.
    const lotLink = (crew.Location.locations || []).find((l) => l.label === Entity.IDS.LOT);
    if (lotLink) crewLotId = lotLink.id;
  }
  const target = Lot.toPosition(targetLotEntity?.id);
  if (!target?.asteroidId) return 0;
  const crewLotIndex = crewLotId ? Lot.toPosition(crewLotId).lotIndex : 0;
  return hopperTravelTime(target.asteroidId, crewLotIndex, target.lotIndex);
}

/**
 * Return `{ asteroidId, lotIndex }` for an arbitrary entity by resolving its
 * Location component. Returns null if we can't locate it. Used by the
 * location-parity validator.
 */
async function getAsteroidLot(entity) {
  const loc = await LocationComponentService.findOneByEntity(entity);
  if (!loc?.location) return null;
  // Walk the chain: lot → asteroid
  const chain = loc.locations || [];
  const lotLink = chain.find((l) => l.label === Entity.IDS.LOT) || (loc.location.label === Entity.IDS.LOT ? loc.location : null);
  const astLink = chain.find((l) => l.label === Entity.IDS.ASTEROID);
  if (!astLink) return null;
  const lotIndex = lotLink ? Lot.toPosition(lotLink.id).lotIndex : 0;
  return { asteroidId: astLink.id, lotIndex, lotId: lotLink?.id || 0 };
}

module.exports = {
  hopperTravelTime,
  crewToLotTravelTime,
  getAsteroidLot
};
