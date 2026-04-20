const mongoose = require('mongoose');
const logger = require('@common/lib/logger');
const SyntheticEvent = require('./helpers/syntheticEvent');
const { ValidationError } = require('./errors');

const loadHandlers = () => {
  // eslint-disable-next-line global-require
  const handlers = {
    // Construction
    ConstructionPlan: require('./handlers/construction/plan'),
    ConstructionStart: require('./handlers/construction/start'),
    ConstructionFinish: require('./handlers/construction/finish'),
    ConstructionDeconstruct: require('./handlers/construction/deconstruct'),
    ConstructionAbandon: require('./handlers/construction/abandon'),
    // Crew
    StationCrew: require('./handlers/crew/station'),
    EjectCrew: require('./handlers/crew/eject'),
    ArrangeCrew: require('./handlers/crew/arrange'),
    ExchangeCrew: require('./handlers/crew/exchange'),
    ResupplyFood: require('./handlers/crew/resupplyFood'),
    // Scanning
    ScanSurfaceStart: require('./handlers/production/scanSurfaceStart'),
    ScanSurfaceFinish: require('./handlers/production/scanSurfaceFinish'),
    ScanResourcesStart: require('./handlers/production/scanResourcesStart'),
    ScanResourcesFinish: require('./handlers/production/scanResourcesFinish'),
    // Core sampling
    SampleDepositStart: require('./handlers/production/sampleDepositStart'),
    SampleDepositImprove: require('./handlers/production/sampleDepositImprove'),
    SampleDepositFinish: require('./handlers/production/sampleDepositFinish'),
    // Extraction
    ExtractResourceStart: require('./handlers/production/extractResourceStart'),
    ExtractResourceFinish: require('./handlers/production/extractResourceFinish'),
    // Processing
    ProcessProductsStart: require('./handlers/production/processProductsStart'),
    ProcessProductsFinish: require('./handlers/production/processProductsFinish'),
    // Ship & Transit
    AssembleShipStart: require('./handlers/ship/assembleStart'),
    AssembleShipFinish: require('./handlers/ship/assembleFinish'),
    TransitBetweenStart: require('./handlers/ship/transitStart'),
    TransitBetweenFinish: require('./handlers/ship/transitFinish'),
    DockShip: require('./handlers/ship/dock'),
    UndockShip: require('./handlers/ship/undock'),
    CommandeerShip: require('./handlers/ship/commandeer'),
    // Delivery
    SendDelivery: require('./handlers/delivery/send'),
    PackageDelivery: require('./handlers/delivery/package'),
    AcceptDelivery: require('./handlers/delivery/accept'),
    CancelDelivery: require('./handlers/delivery/cancel'),
    ReceiveDelivery: require('./handlers/delivery/receive'),
    DumpDelivery: require('./handlers/delivery/dump'),
    // TODO: Add remaining handlers as they are implemented
  };

  // Aliases for composite/flexible client action names.
  // In hybrid mode, these resolve to the same handler since on-chain
  // lease/purchase/initialize logic is not needed locally.
  handlers.InitializeAndStartSurfaceScan = handlers.ScanSurfaceStart;
  handlers.InitializeAndStartTransit = handlers.TransitBetweenStart;
  handlers.FlexibleExtractResourceStart = handlers.ExtractResourceStart;
  handlers.LeaseAndProcessProductsStart = handlers.ProcessProductsStart;
  handlers.LeaseAndAssembleShipStart = handlers.AssembleShipStart;
  handlers.PurchaseDepositAndImprove = handlers.SampleDepositImprove;

  return handlers;
};

class GameEngine {
  static _handlers = null;

  static get handlers() {
    if (!this._handlers) this._handlers = loadHandlers();
    return this._handlers;
  }

  /**
   * Execute a game action. This is the main entry point called by the
   * actions controller (POST /v2/actions/:action).
   *
   * Two-phase execution:
   *   Phase 1: validate + write components + create synthetic event.
   *     Runs inside a MongoDB session/transaction, but note that only the
   *     Entity upsert and synthetic event creation honour the session.
   *     ComponentService writes bypass it (no session param support).
   *     Idempotency keys provide crash-safety for the overall operation.
   *   Phase 2 (non-transactional): run existing Dispatcher handler for side effects
   *
   * @param {object} params
   * @param {string} params.action - Action name (e.g. 'ConstructionPlan')
   * @param {string} params.address - Caller's wallet address
   * @param {object} params.callerCrew - { id, label } of the calling crew
   * @param {object} params.vars - Action-specific variables
   * @param {object} params.meta - Optional metadata
   * @param {string} params.idempotencyKey - Client-provided key for crash-safe retries
   * @returns {object} Action result
   */
  static async execute({ action, address, callerCrew, vars, meta, idempotencyKey }) {
    // ── Idempotency check ────────────────────────────────────────────
    if (idempotencyKey) {
      const existing = await SyntheticEvent.findByIdempotencyKey(idempotencyKey);
      if (existing) return { event: existing, replayed: true };
    }

    const HandlerClass = this.handlers[action];
    if (!HandlerClass) {
      throw new ValidationError(`Unknown action: ${action}`);
    }

    const handler = new HandlerClass({ action, address, callerCrew, vars, meta, idempotencyKey });

    // ── Phase 1: Validate + Write (session-scoped) ────────────────────
    const session = await mongoose.startSession();
    let result;

    try {
      session.startTransaction();
      handler.setSession(session);

      await handler.validate();
      result = await handler.writePhase();

      await session.commitTransaction();
    } catch (error) {
      await session.abortTransaction();

      // Duplicate idempotency key from a concurrent request - treat as replay
      if (idempotencyKey && error.code === 11000 && error.message?.includes('idempotency')) {
        const existing = await SyntheticEvent.findByIdempotencyKey(idempotencyKey);
        if (existing) return { event: existing, replayed: true };
      }

      throw error;
    } finally {
      session.endSession();
    }

    // ── Phase 2: Side effects (non-transactional) ────────────────────
    try {
      await handler.sideEffectPhase();
    } catch (error) {
      logger.error(`Side effect phase failed for ${action}:`, error);
    }

    // 3. Emit Socket.IO events
    try {
      await handler.emitEvents();
    } catch (error) {
      logger.error(`Socket event emission failed for ${action}:`, error);
    }

    return result;
  }
}

module.exports = GameEngine;
