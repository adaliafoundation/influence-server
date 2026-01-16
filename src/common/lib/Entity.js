const { num: { isHex, toHex } } = require('starknet');
const { isNumber, isNil } = require('lodash');
const { Entity: { IDS, packEntity, unpackEntity } } = require('@influenceth/sdk');

class Entity {
  id = null;

  label = null;

  uuid = null;

  constructor({ id, label, uuid } = {}) {
    if (uuid) {
      if (!isHex(uuid)) throw new Error('Invalid uuid');

      this.id = (unpackEntity(uuid)).id;
      this.label = (unpackEntity(uuid)).label;
      this.uuid = uuid;
    } else if (id && label) {
      this.id = Number(id);
      this.label = Number(label);
      this.uuid = this.constructor.toUuid(this.id, this.label);
    } else {
      throw new Error('Missing uuid or id and label');
    }
  }

  toObject() {
    return { id: this.id, label: this.label, uuid: this.uuid };
  }

  unpackLot() {
    if (!this.isLot()) throw new Error('Entity not a lot');

    const split = 2 ** 32;
    return {
      asteroidEntity: Entity.Asteroid(this.id % split),
      asteroidId: Entity.Asteroid(this.id % split).id,
      lotId: Math.floor(this.id / split),
      lotIndex: Math.floor(this.id / split)
    };
  }

  isCrew() {
    return this.label === IDS.CREW;
  }

  isCrewmate() {
    return this.label === IDS.CREWMATE;
  }

  isAsteroid() {
    return this.label === IDS.ASTEROID;
  }

  isLot() {
    return this.label === IDS.LOT;
  }

  isBuilding() {
    return this.label === IDS.BUILDING;
  }

  isShip() {
    return this.label === IDS.SHIP;
  }

  isDeposit() {
    return this.label === IDS.DEPOSIT;
  }

  isDelivery() {
    return this.label === IDS.DELIVERY;
  }

  isValid() {
    return this.isValidId() && this.isValidLabel() && this.isValidUuid();
  }

  isValidLabel() {
    return !isNil(this.label) && Object.values(IDS).includes(this.label);
  }

  isValidId() {
    return !isNil(this.id) && isNumber(this.id) && this.id > 0;
  }

  isValidUuid() {
    return !isNil(this.uuid) && isHex(this.uuid);
  }

  /* Statics */
  static get IDS() {
    return IDS;
  }

  static fromUuid(uuid) {
    return new Entity({ uuid: toHex(uuid) });
  }

  static fromIdAndLabel(id, label) {
    return new Entity({ id, label });
  }

  static toUuid(id, label) {
    if (!id || !label) throw new Error('Missing id and/or label');
    return toHex(packEntity({ id, label }));
  }

  static toEntity({ id, label, uuid }) {
    return new Entity({ id, label, uuid });
  }

  static areEqual(entityA, entityB) {
    if (!entityA && !entityB) throw new Error('Invalid entities');
    if (!entityA || !entityB) return false;
    let _entityA = entityA;
    let _entityB = entityB;

    if (typeof entityA === 'object') _entityA = this.toEntity(entityA);
    if (typeof entityB === 'object') _entityB = this.toEntity(entityB);
    if (typeof entityA === 'string') _entityA = this.fromUuid(entityA);
    if (typeof entityB === 'string') _entityB = this.fromUuid(entityB);

    return _entityA?.uuid === _entityB?.uuid;
  }

  static lotFromIndex(asteroidId, lotIndex) {
    return this.Lot(asteroidId + (lotIndex * (2 ** 32)));
  }

  static Asteroid(id) {
    return new Entity({ id, label: IDS.ASTEROID });
  }

  static Building(id) {
    return new Entity({ id, label: IDS.BUILDING });
  }

  static Crew(id) {
    return new Entity({ id, label: IDS.CREW });
  }

  static Crewmate(id) {
    return new Entity({ id, label: IDS.CREWMATE });
  }

  static Delivery(id) {
    return new Entity({ id, label: IDS.DELIVERY });
  }

  static Deposit(id) {
    return new Entity({ id, label: IDS.DEPOSIT });
  }

  static Lot(id) {
    return new Entity({ id, label: IDS.LOT });
  }

  static Ship(id) {
    return new Entity({ id, label: IDS.SHIP });
  }

  static isAsteroid(entity) {
    return this.toEntity(entity).isAsteroid();
  }

  static isBuilding(entity) {
    return this.toEntity(entity).isBuilding();
  }

  static isCrew(entity) {
    return this.toEntity(entity).isCrew();
  }

  static isCrewmate(entity) {
    return this.toEntity(entity).isCrewmate();
  }

  static isDeposit(entity) {
    return this.toEntity(entity).isDeposit();
  }

  static isDelivery(entity) {
    return this.toEntity(entity).isDelivery();
  }

  static isLot(entity) {
    return this.toEntity(entity).isLot();
  }

  static isShip(entity) {
    return this.toEntity(entity).isShip();
  }
}

module.exports = Entity;
