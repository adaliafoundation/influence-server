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

class PackedLotDataService {
  static PACKED_WIDTH = 8;

  static hasAgreement(data) {
    const lotData = (isArray(data)) ? data : data.split('');
    return lotData[4] === '1' && lotData[5] === '0';
  }

  static isLeaseable(data) {
    const lotData = (isArray(data)) ? data : data.split('');
    return lotData[4] === '0' && lotData[5] === '1';
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
   * Gather data from the database and build the packed data for a single log in bit string notation
   * @param {lotEntity} Lot entity id and label === Entity.IDS.LOT
   * @returns {string}
   */
  static async buildForLot(lot) {
    const lotEntity = Entity.toEntity(lot);
    const [
      buildingTypeOrStatus,
      locationsWithCrew,
      leaseStatus
    ] = await Promise.all([
      this._buildingTypeOrStatus(lotEntity),
      mongoose.model('LocationComponent').exists({
        'locations.uuid': lotEntity.uuid,
        'entity.label': Entity.IDS.CREW
      }),
      LotService.getLeaseStatus(lotEntity)
    ]);

    const value = [
      (buildingTypeOrStatus || 0).toString(2).padStart(4, 0), // (buildingType)
      (leaseStatus || 0).toString(2).padStart(2, 0), // (lease status) if lot is leased
      (locationsWithCrew) ? '1' : '0', // (has crew) check if lot has a crew
      '0' // currently unused
    ].join('');

    if (value.length !== this.PACKED_WIDTH) throw new Error('Invalid packed value');

    return value;
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
    const data = new Array(lotCount).fill('0'.repeat(this.PACKED_WIDTH));
    let bufferCount = 0;
    await eachLimit(range(1, lotCount + 1), 100, async (lotIndex) => {
      Logger.verbose(`PackedLotDataService::build: lotIndex: ${lotIndex}/${lotCount}`);
      const lotEntity = Entity.lotFromIndex(asteroidEntity.id, lotIndex);
      const packedData = await this.buildForLot(lotEntity);

      data[lotIndex - 1] = packedData;
      bufferCount += 1;

      if (bufferCount >= BUFFER_SIZE && save) {
        Logger.debug(`PackedLotDataService::build: bufferCount >= ${BUFFER_SIZE}, updating cache...`);
        bufferCount = 0;

        // Incremental cache update
        const packed = PackedData.fromString(data.join(''), this.PACKED_WIDTH);
        await this._cacheSet(asteroidEntity, packed);
      }
    });

    timer.stop();
    Logger.debug(`PackedLotDataService::build: ${timer.format()}`);
    if (save) {
      const packed = PackedData.fromString(data.join(''), this.PACKED_WIDTH);
      await this._cacheSet(asteroidEntity, packed);
    }

    return PackedData.fromString(data.join(''), this.PACKED_WIDTH);
  }

  /**
   * Initialize the packed data for an asteroid, sets all values to 0 for all lots
   * @param {Object} asteroidEntity
   */
  static async initForAsteroid(asteroid) {
    const asteroidEntity = Entity.toEntity(asteroid);
    const lotCount = Asteroid.getSurfaceArea(asteroidEntity.id);

    const data = new Array(lotCount).fill('0'.repeat(this.PACKED_WIDTH));
    const packed = PackedData.fromString(data.join(''), this.PACKED_WIDTH);
    await this._cacheSet(asteroidEntity, packed);
    return packed;
  }

  /**
   * Update the packed data for a single lot
   * @param {AsteroidDocument|String} asteroid
   * @param {LotDocument|String} lot
   * @returns {Promise<PackedData>}
   */
  static async update(lot, packedData) {
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
    await this._cacheSet(asteroidEntity, _packedData);

    return _packedData;
  }

  static async updateLotCrewStatus(lot) {
    const lotEntity = Entity.toEntity(lot);
    const { asteroidId, lotIndex } = lotEntity.unpackLot();
    const asteroidEntity = Entity.Asteroid(asteroidId);

    const crewExists = await mongoose.model('LocationComponent').exists({
      'locations.uuid': lotEntity.uuid,
      'entity.label': Entity.IDS.CREW
    });

    // get all the packed data for the asteroid
    const packedData = await this._cacheGet(asteroidEntity);

    // get the packed data for the lot and convert to array
    const lotData = packedData.get(lotIndex - 1).split('');

    lotData.splice(6, 1, (crewExists ? '1' : '0'));
    packedData.set(lotIndex - 1, lotData.join(''));
    await this._cacheSet(asteroidEntity, packedData);
    return packedData;
  }

  static async updateBuildingTypeForLot(lot) {
    const lotEntity = Entity.toEntity(lot);
    const { asteroidId, lotIndex } = lotEntity.unpackLot();
    const asteroidEntity = Entity.Asteroid(asteroidId);

    // get all the packed data for the asteroid
    const packedData = await this.get(asteroidEntity);

    // get the packed data for the lot and convert to array
    const lotData = packedData.get(lotIndex - 1).split('');

    // get the building type for the lot
    const buildingTypeOrStatus = await this._buildingTypeOrStatus(lotEntity);

    lotData.splice(0, 4, ...buildingTypeOrStatus.toString(2).padStart(4, 0).split(''));
    packedData.set(lotIndex - 1, lotData.join(''));
    await this._cacheSet(asteroidEntity, packedData);
  }

  static async updateLotLeaseStatus(lot) {
    const lotEntity = Entity.toEntity(lot);
    if (!lotEntity.isLot()) throw new Error('Entity not a lot');

    const { asteroidId, lotIndex } = lotEntity.unpackLot();
    const asteroidEntity = Entity.Asteroid(asteroidId);

    // get the current cached packed data
    const packedData = await this.get(asteroidEntity);

    // if no data in cache, build it and cache it
    if (!packedData) throw new Error('Missing packed data, must be built for the specified asteroid first');

    const packedIndex = lotIndex - 1;

    // get the current packed data for the lot and convert to array
    const lotData = packedData.get(packedIndex).split('');

    // init the updated lot data with the current data
    const updatedLotData = [...lotData];

    // get the lease status for the lot
    const leaseStatus = await LotService.getLeaseStatus(lotEntity);

    // update the lease status bits
    updatedLotData.splice(4, 2, ...leaseStatus.toString(2).padStart(2, 0).split(''));

    // no need for update if the data is the same
    if (lotData.join('') === updatedLotData.join('')) return packedData;

    packedData.set(packedIndex, updatedLotData.join(''));

    await this._cacheSet(asteroidEntity, packedData);

    return packedData;
  }

  static async updateLotToLeased(lot) {
    const lotEntity = Entity.toEntity(lot);
    if (!lotEntity.isLot()) throw new Error('Entity not a lot');

    const { asteroidId, lotIndex } = lotEntity.unpackLot();
    const asteroidEntity = Entity.Asteroid(asteroidId);

    // get the current cached packed data
    const packedData = await this.get(asteroidEntity);

    // if no data in cache, build it and cache it
    if (!packedData) throw new Error('Missing packed data, must be built for the specified asteroid first');

    const packedIndex = lotIndex - 1;
    const lotData = packedData.get(packedIndex).split('');
    lotData.splice(4, 2, '1', '0');
    packedData.set(packedIndex, lotData.join(''));

    await this._cacheSet(asteroidEntity, packedData);

    return packedData;
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
      const lotData = packedData.get(packedIndex).split('');

      // if has a current agreement but force is not true, skip
      if (!this.hasAgreement(lotData) || (this.hasAgreement(lotData) && clearAgreements)) {
        // update the lease status to 0
        lotData.splice(4, 2, '0', '1');

        // update the packed data object
        packedData.set(packedIndex, lotData.join(''));
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
      const lotData = packedData.get(packedIndex).split('');

      // if has a current agreement but force is not true, skip
      if (!this.hasAgreement(lotData) || (this.hasAgreement(lotData) && clearAgreements)) {
        // update the lease status to 0
        lotData.splice(4, 2, '0', '0');

        // update the packed data object
        packedData.set(packedIndex, lotData.join(''));
      }
    }

    // update the cache
    await this._cacheSet(asteroidEntity, packedData);

    return packedData;
  }

  /* Private */

  static async _buildingTypeOrStatus(lot) {
    const lotEntity = Entity.toEntity(lot);

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
      // special case, return 14 to indicate that the building is under construction
      const { PLANNED, UNDER_CONSTRUCTION } = Building.CONSTRUCTION_STATUSES;
      if ([PLANNED, UNDER_CONSTRUCTION].includes(building.status)) return 14;

      // return building type if building found on lot
      if (building.status && building.buildingType > 0 && Building.TYPES[building.buildingType]) {
        return Building.TYPES[building.buildingType].category;
      }
    }

    // special case, return 15 to represent a ship on the lot
    if (shipLocationDoc) return 15;

    return 0;
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
