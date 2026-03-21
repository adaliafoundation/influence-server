const mongoose = require('mongoose');
const { isArray, range, without } = require('lodash');
const { eachLimit } = require('async');
const { Timer } = require('timer-node');
const { Asteroid, Building } = require('@influenceth/sdk');
const Entity = require('@common/lib/Entity');
const PackedData = require('@common/lib/PackedData');
const { LotDataCache } = require('@common/lib/cache');
const Logger = require('@common/lib/logger');
const LotService = require('../Lot');

const LotAttribute = {
  HAS_SAMPLES:   { value: "hasSamples"  , mask: 0b0000000000000001, shift: 0, compute: async (lotEntity) => { return 0; } },  // Chvx -> found on client side but not here?
  HAS_CREW:      { value: "hasCrew"     , mask: 0b0000000000000010, shift: 1, compute: async (lotEntity) => { return await PackedLotDataService._locationWithCrew(lotEntity); } },
  LEASE_STATUS:  { value: "leaseStatus" , mask: 0b0000000000001100, shift: 2, compute: async (lotEntity) => { return await LotService.getLeaseStatus(lotEntity); } },
  BUILDING_TYPE: { value: "buildingType", mask: 0b0000001111110000, shift: 4, compute: async (lotEntity) => { return await PackedLotDataService._buildingTypeOrStatus(lotEntity); } },
}

const LotSpecialType = { EMPTY: 0, CONTRUCTION_SITE: 62, LANDED_SHIP: 63}

class PackedLotDataService {
  static PACKED_WIDTH = 10;  // align with client-side src/lib/api.js getAsteroidLotData()

  static hasAgreement(data) {
    return ((data & LotAttribute.LEASE_STATUS.mask) >>> LotAttribute.LEASE_STATUS.shift) === 2;
  }

  static isLeaseable(data) {
    return ((data & LotAttribute.LEASE_STATUS.mask) >>> LotAttribute.LEASE_STATUS.shift) === 1;
  }

  /**
   * Get the packed data for the specified asteroid.
   * If not found it cache, init lot data in cache and return empty packed lot data.
   * @param {AsteroidEntity} asteroid
   * @returns Promise<PackedData>
   */
  static async get(asteroid) {
    const asteroidEntity = Entity.toEntity(asteroid);
    const packedData = await this._cacheGet(asteroidEntity);
    return packedData || this.initForAsteroid(asteroidEntity);
  }

  static async getForLot(lot) {
    const lotEntity = Entity.toEntity(lot);
    const { asteroidEntity, lotIndex } = lotEntity.unpackLot();
    const packedData = await this.get(asteroidEntity);
    if (!packedData) throw new Error('Missing packed data, must be built for the specified asteroid first');

    return packedData.get(lotIndex - 1);
  }

  /**
   * Gather data from the database and build the packed data for a single lot
   * @param {lotEntity} Lot entity id and label === Entity.IDS.LOT
   * @returns {Number}
   */
  static async buildForLot(lot) {
    const lotEntity = Entity.toEntity(lot);

    const attributes = Object.values(LotAttribute);

    const computedBits = await Promise.all(
      attributes.map(async (attribute) => {
          const value = await attribute.compute.call(this, lotEntity);
          return (value << attribute.shift) & attribute.mask;
      })
    );

    return computedBits.reduce((acc, bits) => acc | bits, 0);
  }

  /**
   * Construct the packed data for all lots on an asteroid
   * @param {Object} asteroidId
   * @returns {Promise<PackedData>}
   */
  static async build(asteroid, save = true) {
    const BUFFER_SIZE = 50;
    if (typeof asteroid !== 'object') throw new Error('Invalid asteroid entity');
    const asteroidEntity = Entity.toEntity(asteroid);
    const timer = new Timer({ label: `Asteroid (${asteroidEntity.id}) LotData Build Timer` });
    timer.start();

    const lotCount = Asteroid.getSurfaceArea(asteroidEntity.id);
    Logger.debug(`PackedLotDataService::build (${asteroidEntity.id}), lotCount: ${lotCount}`);

    // init lot docs with empty data
    const packedData = new PackedData({ size: lotCount, packedWidth: this.PACKED_WIDTH });
    let bufferCount = 0;
    await eachLimit(range(1, lotCount + 1), 100, async (lotIndex) => {
      Logger.verbose(`PackedLotDataService::build: lotIndex: ${lotIndex}/${lotCount}`);
      const lotEntity = Entity.lotFromIndex(asteroidEntity.id, lotIndex);
      const lotData = await this.buildForLot(lotEntity);

      if (lotData > 0) {
        packedData.set(lotIndex - 1, lotData);
        bufferCount += 1;

        if (bufferCount >= BUFFER_SIZE && save) {
          Logger.debug(`PackedLotDataService::build: bufferCount >= ${BUFFER_SIZE}, updating cache...`);
          bufferCount = 0;

          // Incremental cache update
          await this._cacheSet(asteroidEntity, packedData);
        }
      }
    });

    timer.stop();
    Logger.debug(`PackedLotDataService::build: ${timer.format()}`);
    if (save) {
      await this._cacheSet(asteroidEntity, packedData);
    }

    return packedData;
  }

  /**
   * Initialize the packed data for an asteroid, sets all values to 0 for all lots
   * @param {Object} asteroidEntity
   */
  static async initForAsteroid(asteroid) {
    const asteroidEntity = Entity.toEntity(asteroid);
    const lotCount = Asteroid.getSurfaceArea(asteroidEntity.id);

    const packed = new PackedData({ size: lotCount, packedWidth: this.PACKED_WIDTH });
    await this._cacheSet(asteroidEntity, packed);
    return packed;
  }

  /**
   * Initialize the packed data for a leasable asteroid, sets all values to leasable for all lots
   * @param {Object} asteroidEntity
   */
  static async initForLeasableAsteroid(asteroid) {
    const asteroidEntity = Entity.toEntity(asteroid);
    const lotCount = Asteroid.getSurfaceArea(asteroidEntity.id);

    const packed = new PackedData({ size: lotCount, packedWidth: this.PACKED_WIDTH });
    
    const lotIndices = range(1, lotCount + 1);
    for (const lotIndex of lotIndices) {
      packed.set(lotIndex, 1 << LotAttribute.LEASE_STATUS.shift);
    }

    await this._cacheSet(asteroidEntity, packed);
    return packed;
  }

  /**
   * Update the packed data for a single lot
   * @param {AsteroidDocument|String} asteroid
   * @param {LotDocument|String} lot
   * @returns {Promise<PackedData>}
   */
  static async update(lot, packedData, save = true) {
    const lotEntity = Entity.toEntity(lot);
    if (!lotEntity.isLot()) throw new Error('Entity not a lot');

    const { asteroidId, lotIndex } = lotEntity.unpackLot();
    const asteroidEntity = Entity.Asteroid(asteroidId);

    if (packedData && !(packedData instanceof PackedData)) throw new Error('Invalid packed data');

    // use the pased in packed data or get the current cached packed data
    let _packedData = packedData || await this.get(asteroidEntity);

    // if no data in cache, init
    if (!_packedData) _packedData = await this.initForAsteroid(asteroidEntity);

    // build the packed data for the lot
    const packedLotData = await this.buildForLot(lotEntity);

    // get what is currently in the cache (or instance)
    const currentData = _packedData.get(lotIndex - 1);

    // if the data is the same, no update needed, return the current packed data
    if (currentData === packedLotData) return _packedData;

    await _packedData.set(lotIndex - 1, packedLotData);
    if (save) await this._cacheSet(asteroidEntity, _packedData);

    return _packedData;
  }

  static async updateLotAttribute(lot, lotAttribute, forcedValue) {
	
    const lotEntity = Entity.toEntity(lot);
    if (!lotEntity.isLot()) throw new Error('Entity not a lot');

    const { asteroidId, lotIndex } = lotEntity.unpackLot();
    const asteroidEntity = Entity.Asteroid(asteroidId);

    // get the current cached packed data
    const packedData = await this.get(asteroidEntity);

    // if no data in cache, build it and cache it
    if (!packedData) throw new Error('Missing packed data, must be built for the specified asteroid first');

    const packedIndex = lotIndex - 1;

    // get the current packed data for the lot
    const lotData = packedData.get(packedIndex)
	
    // set the correct mask, shift, and value based on attribute; use forceValue if provided
    const { mask, shift, compute } = lotAttribute;
    const rawValue = forcedValue !== undefined
      ? forcedValue
      : await compute.call(this, lotEntity);

    const shiftedValue = (rawValue << shift) & mask;
    
    // clear then set the bits
    const updatedLotData = (lotData & ~mask) | shiftedValue;

    // no need for update if the data is the same
    if (lotData === updatedLotData) return packedData;
    
    packedData.set(packedIndex, updatedLotData);

    await this._cacheSet(asteroidEntity, packedData);

    return packedData;
  }

  static async updateLotCrewStatus(lot) {
    return await this.updateLotAttribute(lot, LotAttribute.HAS_CREW);
  }

  static async updateBuildingTypeForLot(lot) {
    return await this.updateLotAttribute(lot, LotAttribute.BUILDING_TYPE);
  }

  static async updateLotLeaseStatus(lot) {
    return await this.updateLotAttribute(lot, LotAttribute.LEASE_STATUS);
  }

  static async updateLotToLeased(lot) {
    return await this.updateLotAttribute(lot, LotAttribute.LEASE_STATUS, 2);
  }

  /**
   * For all of the lots on the asteroid, lotUuids or lotIndices, update the lease status
   * Convert all the lots to leaseable (1)
   * If the current value is 2 (has agreement), it will not be updated unless force is true
   *
   * @param {Object} asteroidEntity
   * @param {Array} lotUuids
   * @param {Array} lotIndices
   * @param {Boolean} force
   *
   * @returns {Promise<PackedData>}
   */
  static async updateLotsToLeaseable({ asteroidEntity, lotUuids = [], lotIndices = [], clearAgreements = false }) {
    let _lotIndices;
    const packedData = await this.get(asteroidEntity);
    if (!packedData) throw new Error('Missing packed data, must be built for the specified asteroid first');

    // get a list of non-leasable lot indices
    const nonLeasableLotUuids = await LotService.getLotsWithBuildingControlledByAsteroidController(asteroidEntity);
    const nonLeasableLotIndices = nonLeasableLotUuids.map((lot) => lot.unpackLot().lotIndex);

    const lotCount = Asteroid.getSurfaceArea(asteroidEntity.id);
    if (asteroidEntity) {
      _lotIndices = range(1, lotCount + 1);
    } else if (lotUuids) {
      _lotIndices = lotUuids.map((lotUuid) => {
        const lotEntity = Entity.fromUuid(lotUuid);
        const { lotIndex } = lotEntity.unpackLot();
        if (lotIndex > lotCount) throw new Error('Invalid lot index');
        return lotIndex;
      });
    } else if (lotIndices) {
      _lotIndices = lotIndices.map(Number);
    } else {
      throw new Error('Missing asteroid or lotUuids or lotIndices');
    }

    _lotIndices = without(_lotIndices, ...nonLeasableLotIndices);

    for (const lotIndex of _lotIndices) {
      const packedIndex = lotIndex - 1;
      const lotData = packedData.get(packedIndex);

      // if has a current agreement but force is not true, skip
      if (!this.hasAgreement(lotData) || (this.hasAgreement(lotData) && clearAgreements)) {
        // update the lease status to 1
        const { mask, shift } = LotAttribute.LEASE_STATUS;
        const updatedLotData = (lotData & ~mask) | (1 << shift);

        // update the packed data object
        packedData.set(packedIndex, updatedLotData);
      }
    }

    await this._cacheSet(asteroidEntity, packedData);

    return packedData;
  }

  /**
   * For all of the lots on the asteroid, lotUuids or lotIndices, update the lease status
   * Convert all the lots to non-leaseable (0)
   * If the current value is 2 (has agreement), it will not be updated unless force is true
   *
   * @param {Object} asteroidEntity
   * @param {Array} lotUuids
   * @param {Array} lotIndices
   * @param {Boolean} force
   *
   * @returns {Promise<PackedData>}
   */
  static async updateLotsToNonLeaseable({ asteroidEntity, lotUuids = [], lotIndices = [], clearAgreements = false }) {
    let _lotIndices;
    const packedData = await this.get(asteroidEntity);
    if (!packedData) throw new Error('Missing packed data, must be built for the specified asteroid first');

    const lotCount = Asteroid.getSurfaceArea(asteroidEntity.id);
    if (asteroidEntity) {
      _lotIndices = range(1, lotCount + 1);
    } else if (lotUuids) {
      _lotIndices = lotUuids.map((lotUuid) => {
        const lotEntity = Entity.Lot(lotUuid);
        const { lotIndex } = lotEntity.unpackLot();
        if (lotIndex > lotCount) throw new Error('Invalid lot index');
        return lotIndex;
      });
    } else if (lotIndices) {
      _lotIndices = lotIndices.map(Number);
    } else {
      throw new Error('Missing asteroid or lotUuids or lotIndices');
    }

    for (const lotIndex of _lotIndices) {
      const packedIndex = lotIndex - 1;
      const lotData = packedData.get(packedIndex);

      // if has a current agreement but force is not true, skip
      if (!this.hasAgreement(lotData) || (this.hasAgreement(lotData) && clearAgreements)) {
        // update the lease status to 0 (= clear bits)
        const updatedLotData = lotData & ~ LotAttribute.LEASE_STATUS.mask;

        // update the packed data object
        packedData.set(packedIndex, updatedLotData);
      }
    }

    // update the cache
    await this._cacheSet(asteroidEntity, packedData);

    return packedData;
  }

  /* Private */

  static async _buildingTypeOrStatus(lotEntity) {

    const [buildingLocationDoc, shipLocationDoc] = await Promise.all([
      mongoose.model('LocationComponent').findOne({
        'location.uuid': lotEntity.uuid,
        'entity.label': Entity.IDS.BUILDING
      }).sort({ 'entity.id': -1 }).populate(['virtuals.building']),
      mongoose.model('LocationComponent').findOne({
        'location.uuid': lotEntity.uuid,
        'entity.label': Entity.IDS.SHIP
      }).sort({ 'entity.id': -1 })
    ]);

    if (!buildingLocationDoc && !shipLocationDoc) return 0;

    if (buildingLocationDoc?.virtuals?.building) {
      const { virtuals: { building } } = buildingLocationDoc.toJSON();
      // special case, building is under construction
      const { PLANNED, UNDER_CONSTRUCTION } = Building.CONSTRUCTION_STATUSES;
      if ([PLANNED, UNDER_CONSTRUCTION].includes(building.status)) return LotSpecialType.CONTRUCTION_SITE;

      // return building type if building found on lot
      if (building.status && building.buildingType > 0 && Building.TYPES[building.buildingType]) {
        return building.buildingType;
      }
    }

    // special case, landed ship
    if (shipLocationDoc) return LotSpecialType.LANDED_SHIP;

    return 0;
  }

  static async _locationWithCrew(lotEntity) {
    const exists = await mongoose.model('LocationComponent').exists({
          'locations.uuid': lotEntity.uuid,
          'entity.label': Entity.IDS.CREW
        });

    return exists ? 1 : 0;
  }

  /**
   * Get the cached packed lots data for an asteroid
   * @param {AsteroidDocument|String} asteroid
   * @returns {Promise<PackedData>}
   */
  static async _cacheGet(asteroidEntity) {
    const data = await LotDataCache.getDataForAsteroid(asteroidEntity.id);
    return (data) ? new PackedData({ packedData: data, packedWidth: this.PACKED_WIDTH }) : null;
  }

  /**
   * Cache the packed lots data for an asteroid
   * @param {asteroidId|String} asteroid
   * @param {PackedData} packedData
   * @returns {Promise<void>}
   */
  static _cacheSet(asteroidEntity, packedData) {
    if (!(packedData instanceof PackedData)) throw new Error('Invalid packed data');
    return LotDataCache.setDataForAsteroid(asteroidEntity.id, packedData.toArray());
  }
}

module.exports = PackedLotDataService;
