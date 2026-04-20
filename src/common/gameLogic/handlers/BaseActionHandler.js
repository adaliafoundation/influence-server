const mongoose = require('mongoose');
const Entity = require('@common/lib/Entity');
const { ComponentService, ElasticSearchService } = require('@common/services');
const SyntheticEvent = require('../helpers/syntheticEvent');

class BaseActionHandler {
  constructor({ action, address, callerCrew, vars, meta, idempotencyKey }) {
    this.action = action;
    this.address = address;
    this.callerCrew = callerCrew;
    this.vars = vars;
    this.meta = meta;
    this.idempotencyKey = idempotencyKey;
    this.systemEvent = null;
    this.session = null;
    this._dispatcherHandler = null;
  }

  /**
   * Called by GameEngine to inject the MongoDB session for Phase 1.
   */
  setSession(session) {
    this.session = session;
  }

  /**
   * Cap a real-seconds duration when MAX_ACTION_SECONDS is set.
   * Useful for dev/testing: `MAX_ACTION_SECONDS=2` makes every timed
   * action complete in at most 2 real seconds instead of hours/days.
   */
  // eslint-disable-next-line class-methods-use-this
  capDuration(realSeconds) {
    const cap = Number(process.env.MAX_ACTION_SECONDS);
    return (cap > 0) ? Math.min(realSeconds, cap) : realSeconds;
  }

  /**
   * Convert game-seconds to real-seconds using TIME_ACCELERATION.
   * SDK times (setupTime, processingTime, etc.) are in game-seconds.
   */
  async gameSecondsToReal(gameSeconds) {
    if (!this._timeAcceleration) {
      const constant = await mongoose.model('Constant')
        .findOne({ name: 'TIME_ACCELERATION' }).lean();
      this._timeAcceleration = Number(constant?.value) || 24;
    }
    return this.capDuration(Math.ceil(gameSeconds / this._timeAcceleration));
  }

  // ── Subclass interface ───────────────────────────────────────────────

  // eslint-disable-next-line class-methods-use-this
  async validate() { throw new Error('Must implement validate()'); }

  // eslint-disable-next-line class-methods-use-this
  async applyStateChanges() { throw new Error('Must implement applyStateChanges()'); }

  // eslint-disable-next-line class-methods-use-this
  getEventName() { throw new Error('Must implement getEventName()'); }

  // eslint-disable-next-line class-methods-use-this
  getReturnValues() { throw new Error('Must implement getReturnValues()'); }

  /**
   * Return the existing Dispatcher system handler class for this action.
   * @returns {Class} e.g., require('...Dispatcher/systems/ConstructionPlanned')
   */
  // eslint-disable-next-line class-methods-use-this
  getDispatcherSystemHandler() { throw new Error('Must implement getDispatcherSystemHandler()'); }

  // ── Phase 1: Write (runs inside transaction) ─────────────────────────

  /**
   * Called by GameEngine inside the transaction. Creates synthetic events
   * and writes components. The synthetic event is saved with the session
   * so it rolls back on abort.
   *
   * NOTE: ComponentService.updateOrCreateFromEvent() does not currently
   * accept a session parameter — its internal save() calls run outside
   * the transaction. The transaction protects the synthetic event creation;
   * idempotency keys provide crash-safety for the overall operation.
   */
  async writePhase() {
    // Create the parent event shell first so that writeComponent /
    // createEntityWithComponents called inside applyStateChanges can
    // reference it as the parent for component sub-events.
    // Use empty returnValues initially — we update them after
    // applyStateChanges, which may generate IDs needed by getReturnValues.
    this.systemEvent = await SyntheticEvent.create({
      eventName: this.getEventName(),
      returnValues: {},
      session: this.session,
      idempotencyKey: this.idempotencyKey
    });

    const result = await this.applyStateChanges();

    // Now that applyStateChanges has run, update with final return values
    const returnValues = this.getReturnValues();
    this.systemEvent.returnValues = {
      ...returnValues,
      ...(this.idempotencyKey && { idempotencyKey: this.idempotencyKey })
    };
    await this.systemEvent.save({ session: this.session });

    return { event: this.systemEvent.toJSON(), ...result };
  }

  // ── Phase 2: Side effects (runs after transaction commit) ────────────

  /**
   * Called by GameEngine AFTER the transaction commits. Runs the existing
   * Dispatcher system handler against the synthetic event. The handler's
   * DB reads can now see the committed component data from Phase 1.
   */
  async sideEffectPhase() {
    const HandlerClass = this.getDispatcherSystemHandler();
    this._dispatcherHandler = new HandlerClass(this.systemEvent);
    await this._dispatcherHandler.processEvent();
    await this._dispatcherHandler.finalizeEvent();
  }

  /**
   * Emit Socket.IO events collected by the Dispatcher handler.
   * Called by GameEngine after sideEffectPhase() completes.
   */
  async emitEvents() {
    if (this._dispatcherHandler) {
      await this._dispatcherHandler.emitSocketEvents();
    }
  }

  // ── Crew busy helper ─────────────────────────────────────────────────

  /**
   * Mark a crew as busy until finishTime by updating the Crew component's
   * readyAt field. Uses merge mode (replace: false) so other fields
   * (roster, lastFed, delegatedTo, etc.) are preserved.
   *
   * In the real game the smart contract emits a ComponentUpdated_Crew
   * event; in hybrid mode the handler must call this explicitly.
   */
  async setCrewBusy(crew, finishTime) {
    const { Entity: EntityIds } = require('@influenceth/sdk');
    await this.writeComponent('Crew', {
      entity: { id: crew.id, label: EntityIds.IDS.CREW },
      readyAt: finishTime,
      lastReadyAt: crew.Crew?.readyAt || 0
    }, { replace: false });
  }

  // ── Component write helpers ──────────────────────────────────────────

  /**
   * Create an Entity document in the Entity collection.
   * Uses updateOne with upsert — same pattern as the entitiesPlugin.
   */
  async createEntity(entityRef) {
    const entityData = Entity.toEntity(entityRef);
    await mongoose.model('Entity').updateOne(
      { uuid: entityData.uuid },
      entityData.toObject(),
      { upsert: true, session: this.session }
    );
    return entityData;
  }

  /**
   * Create a new entity and all its initial components atomically.
   * Creates the Entity document first, then writes each component via
   * ComponentService.updateOrCreateFromEvent().
   */
  async createEntityWithComponents(entityRef, components) {
    const entity = Entity.toEntity(entityRef);
    await mongoose.model('Entity').updateOne(
      { uuid: entity.uuid },
      entity.toObject(),
      { upsert: true, session: this.session }
    );

    const componentResults = [];
    for (const { component, data, options } of components) {
      // eslint-disable-next-line no-await-in-loop
      const componentEvent = await SyntheticEvent.createComponentEvent({
        parentEvent: this.systemEvent,
        componentName: component,
        returnValues: { ...data, entity: entity.toObject() },
        session: this.session
      });

      // eslint-disable-next-line no-await-in-loop
      const result = await ComponentService.updateOrCreateFromEvent({
        component,
        event: componentEvent,
        data: { ...data, entity: entity.toObject() },
        replace: options?.replace !== false,
        session: this.session
      });

      if (result.updated) {
        // eslint-disable-next-line no-await-in-loop
        await ElasticSearchService.queueEntityForIndexing(entity);
      }

      componentResults.push(result);
    }

    return { entity, componentResults };
  }

  /**
   * Write a single component. Use for updating existing entities
   * (e.g., changing Building status). For new entities, prefer
   * createEntityWithComponents().
   */
  async writeComponent(componentName, data, options = {}) {
    const componentEvent = await SyntheticEvent.createComponentEvent({
      parentEvent: this.systemEvent,
      componentName,
      returnValues: data,
      session: this.session
    });

    const result = await ComponentService.updateOrCreateFromEvent({
      component: componentName,
      event: componentEvent,
      data,
      replace: options.replace !== false,
      session: this.session
    });

    if (result.updated && data.entity) {
      await ElasticSearchService.queueEntityForIndexing(data.entity);
    }

    return result;
  }

  /**
   * Delete a component (for actions like ConstructionAbandon).
   */
  // eslint-disable-next-line class-methods-use-this
  async deleteComponent(componentName, data, filter) {
    return ComponentService.deleteOne({ component: componentName, data, filter });
  }

  // ── Inventory reservation helpers ─────────────────────────────────────
  //
  // Cairo keeps reservedMass/reservedVolume on Inventory components as
  // the "promised" capacity usage of in-flight operations (pending
  // deliveries, extract yields, process outputs, sell-order escrow).
  // The same fields exist on InventoryComponent; these helpers do the
  // bookkeeping so individual handlers don't each reimplement it.

  /**
   * Compute mass + volume for a list of `{product, amount}` items using SDK
   * product constants. Returned as integers — SDK per-unit values are
   * already whole numbers.
   */
  // eslint-disable-next-line class-methods-use-this
  _sizeOfItems(items) {
    const { Product } = require('@influenceth/sdk'); // eslint-disable-line global-require
    let mass = 0;
    let volume = 0;
    for (const it of (items || [])) {
      const pt = Product.TYPES[it.product];
      if (pt) {
        mass += (pt.massPerUnit || 0) * (it.amount || 0);
        volume += (pt.volumePerUnit || 0) * (it.amount || 0);
      }
    }
    return { mass, volume };
  }

  /**
   * Reserve capacity in a destination inventory. Writes the component
   * back with reservedMass/reservedVolume incremented by the items' size.
   * Throws if the reservation would exceed the inventory's constraint.
   */
  async reserveInventory(entity, inventory, items) {
    const { Inventory } = require('@influenceth/sdk'); // eslint-disable-line global-require
    const invType = Inventory.TYPES[inventory.inventoryType];
    if (!invType) throw new Error(`Unknown inventory type: ${inventory.inventoryType}`);
    const { mass, volume } = this._sizeOfItems(items);

    const currentMass = inventory.mass || 0;
    const currentVolume = inventory.volume || 0;
    const resMass = (inventory.reservedMass || 0) + mass;
    const resVolume = (inventory.reservedVolume || 0) + volume;

    if (currentMass + resMass > invType.massConstraint) {
      throw new Error('Insufficient reserved mass capacity at destination');
    }
    if (currentVolume + resVolume > invType.volumeConstraint) {
      throw new Error('Insufficient reserved volume capacity at destination');
    }

    await this.writeComponent('Inventory', {
      entity,
      inventoryType: inventory.inventoryType,
      slot: inventory.slot,
      status: inventory.status,
      mass: currentMass,
      volume: currentVolume,
      reservedMass: resMass,
      reservedVolume: resVolume,
      contents: inventory.contents || []
    });
    return { reservedMass: mass, reservedVolume: volume };
  }

  /**
   * Release a prior reservation and add the items to contents. Used when
   * the in-flight operation completes (extract/process finish, delivery
   * receive).
   */
  async unreserveAndDeposit(entity, inventory, items) {
    const { mass, volume } = this._sizeOfItems(items);
    const contents = [...(inventory.contents || [])];
    for (const it of items) {
      const existing = contents.find((c) => c.product === it.product);
      if (existing) existing.amount += it.amount;
      else contents.push({ product: it.product, amount: it.amount });
    }
    const newMass = (inventory.mass || 0) + mass;
    const newVolume = (inventory.volume || 0) + volume;
    const resMass = Math.max(0, (inventory.reservedMass || 0) - mass);
    const resVolume = Math.max(0, (inventory.reservedVolume || 0) - volume);

    await this.writeComponent('Inventory', {
      entity,
      inventoryType: inventory.inventoryType,
      slot: inventory.slot,
      status: inventory.status,
      mass: newMass,
      volume: newVolume,
      reservedMass: resMass,
      reservedVolume: resVolume,
      contents: contents.filter((c) => c.amount > 0)
    });
  }

  /**
   * Release a reservation without depositing contents (used when an action
   * is cancelled mid-flight, e.g. CancelDelivery).
   */
  async unreserveInventory(entity, inventory, items) {
    const { mass, volume } = this._sizeOfItems(items);
    const resMass = Math.max(0, (inventory.reservedMass || 0) - mass);
    const resVolume = Math.max(0, (inventory.reservedVolume || 0) - volume);

    await this.writeComponent('Inventory', {
      entity,
      inventoryType: inventory.inventoryType,
      slot: inventory.slot,
      status: inventory.status,
      mass: inventory.mass || 0,
      volume: inventory.volume || 0,
      reservedMass: resMass,
      reservedVolume: resVolume,
      contents: inventory.contents || []
    });
  }
}

module.exports = BaseActionHandler;
