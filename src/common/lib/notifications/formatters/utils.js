const { Asteroid, Building, Entity, Lot, Ship } = require('@influenceth/sdk');
const appConfig = require('config');

const asteroidName = (a, fallbackText) => {
  if (!a) return fallbackText || 'Asteroid';
  return a.Name?.name || (a.Celestial && Asteroid.Entity.getBaseName(a)) || `#${a.id.toLocaleString()}`;
};
const buildingName = (b, fallbackText) => {
  if (!b) return fallbackText || 'Building';
  return b.Name?.name || `${Building.TYPES[b.Building?.buildingType]?.name || 'Building'} #${b.id.toLocaleString()}`;
};
const crewName = (c, fallbackText) => {
  if (!c) return fallbackText || 'Crew';
  return c.Name?.name || `Crew #${c.id.toLocaleString()}`;
};
const lotName = (lotOrIndex) => {
  let lotIndex = lotOrIndex?.id || lotOrIndex;
  if (!lotIndex) return 'Lot';
  if (BigInt(lotIndex) >= 2n ** 32n) lotIndex = Lot.toIndex(lotIndex);
  return `Lot #${lotIndex.toLocaleString()}`;
};
const shipName = (s, fallbackText) => {
  if (!s) return fallbackText || 'Ship';
  return s.Name?.name || `${Ship.TYPES[s.Ship?.shipType]?.name || 'Ship'} #${s.id.toLocaleString()}`;
};
const entityName = (entity) => {
  switch (entity.label) {
    case Entity.IDS.ASTEROID: return asteroidName(entity);
    case Entity.IDS.BUILDING: return buildingName(entity);
    case Entity.IDS.CREW: return crewName(entity);
    case Entity.IDS.LOT: return lotName(entity);
    case Entity.IDS.SHIP: return shipName(entity);
    default: return 'Entity';
  }
};

//
// Link Formatters
//
const deepLink = function (path = '/', options = {}) {
  const url = new URL(path, appConfig.get('App.clientUrl'));
  if (options.query) Object.keys(options.query).forEach((key) => url.searchParams.append(key, options.query[key]));
  return url.toString();
};
const entityLink = ({ label, id }, options) => {
  // TODO: add a crew specifier to switch to appropriate crew when land?
  switch (label) {
    case Entity.IDS.ASTEROID: return deepLink(`/asteroids/${id}`, options);
    case Entity.IDS.BUILDING: return deepLink(`/building/${id}`, options);
    case Entity.IDS.CREW: return deepLink(`/crew/${id}`, options);
    case Entity.IDS.LOT: return deepLink(`/lot/${id}`, options);
    case Entity.IDS.SHIP: return deepLink(`/ship/${id}`, options);
    default: return deepLink(undefined, options);
  }
};

// TODO:
// third party events:
// CrewEjected
// DeliveryPackaged / DeliveryCancelled
// ShipEjected
// - my squatted lot was repossesed
// - received transfer
// if PASSENGER: TransitStarted TransitFinished dock/undock

// TODO (enhancements):
// - templates
// - lastSeen
// - digest style? grouping?
// - subscribe by event type
// - max emails per day/hr

module.exports = {
  asteroidName,
  buildingName,
  crewName,
  deepLink,
  entityLink,
  entityName,
  lotName,
  shipName
};
