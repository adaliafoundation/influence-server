const mongoose = require('mongoose');
const logger = require('@common/lib/logger');
const { isHybrid } = require('@common/lib/gameMode');
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
    // Marketplace
    CreateBuyOrder: require('./handlers/marketplace/createBuyOrder'),
    CreateSellOrder: require('./handlers/marketplace/createSellOrder'),
    FillBuyOrder: require('./handlers/marketplace/fillBuyOrder'),
    CancelBuyOrder: require('./handlers/marketplace/cancelBuyOrder'),
    FillSellOrder: require('./handlers/marketplace/fillSellOrder'),
    CancelSellOrder: require('./handlers/marketplace/cancelSellOrder'),
    ConfigureExchange: require('./handlers/marketplace/configureExchange'),
    // Agreements & Permissions
    AssignPublicPolicy: require('./handlers/agreements/assignPublicPolicy'),
    RemovePublicPolicy: require('./handlers/agreements/removePublicPolicy'),
    AssignPrepaidPolicy: require('./handlers/agreements/assignPrepaidPolicy'),
    RemovePrepaidPolicy: require('./handlers/agreements/removePrepaidPolicy'),
    AssignContractPolicy: require('./handlers/agreements/assignContractPolicy'),
    Whitelist: require('./handlers/agreements/whitelist'),
    RemoveFromWhitelist: require('./handlers/agreements/removeFromWhitelist'),
    WhitelistAccount: require('./handlers/agreements/whitelistAccount'),
    RemoveAccountFromWhitelist: require('./handlers/agreements/removeAccountFromWhitelist'),
    AcceptPrepaidAgreement: require('./handlers/agreements/acceptPrepaidAgreement'),
    ExtendPrepaidAgreement: require('./handlers/agreements/extendPrepaidAgreement'),
    CancelPrepaidAgreement: require('./handlers/agreements/cancelPrepaidAgreement'),
    TransferPrepaidAgreement: require('./handlers/agreements/transferPrepaidAgreement'),
    AcceptContractAgreement: require('./handlers/agreements/acceptContractAgreement'),
    ReclaimLot: require('./handlers/agreements/reclaimLot'),
    // Misc / Utility
    ChangeName: require('./handlers/misc/changeName'),
    AnnotateEvent: require('./handlers/misc/annotateEvent'),
    RepossessBuilding: require('./handlers/misc/repossessBuilding'),
    ResolveRandomEvent: require('./handlers/misc/resolveRandomEvent'),
    RekeyInbox: require('./handlers/misc/rekeyInbox'),
    DirectMessage: require('./handlers/misc/directMessage'),
    // Emergency
    ActivateEmergency: require('./handlers/misc/activateEmergency'),
    DeactivateEmergency: require('./handlers/misc/deactivateEmergency'),
    CollectEmergencyPropellant: require('./handlers/misc/collectEmergencyPropellant'),
    // Asteroid
    ManageAsteroid: require('./handlers/misc/manageAsteroid'),
    InitializeAsteroid: require('./handlers/misc/initializeAsteroid'),
    PurchaseAsteroid: require('./handlers/misc/purchaseAsteroid'),
    // Deposit Sales
    ListDepositForSale: require('./handlers/misc/listDepositForSale'),
    UnlistDepositForSale: require('./handlers/misc/unlistDepositForSale'),
    PurchaseDeposit: require('./handlers/misc/purchaseDeposit'),
    // Rewards
    ClaimPrepareForLaunchReward: require('./handlers/misc/claimPrepareForLaunchReward'),
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
  handlers.EscrowDepositAndCreateBuyOrder = handlers.CreateBuyOrder;

  // Aliases for asteroid initialization composites (handled by BATCH_ACTIONS decompose)
  // are not needed here — they are resolved through the BATCH_ACTIONS table.

  return handlers;
};

/**
 * Virtual/batch actions that decompose into multiple individual handler calls.
 * Each entry maps a client action name to the underlying handler name.
 * When vars is an array, each element is executed as a separate action.
 */
const BATCH_ACTIONS = {
  BulkFillSellOrder: { handler: 'FillSellOrder' },
  EscrowWithdrawalAndFillBuyOrders: {
    handler: 'FillBuyOrder',
    cancelHandler: 'CancelBuyOrder',
    getCancelFlag: (meta) => meta?.isCancellation
  },
  // UpdatePolicy decomposes into [remove old policy, add new policy].
  // The client passes { add: 'AssignPrepaidPolicy', remove: 'RemovePublicPolicy', ...vars }.
  UpdatePolicy: {
    decompose: (vars) => {
      const { add, remove, ...baseVars } = vars;
      const calls = [];
      if (remove) calls.push({ action: remove, vars: baseVars });
      if (add) calls.push({ action: add, vars: baseVars });
      return calls;
    }
  },
  // UpdateAllowlists decomposes into individual add/remove whitelist operations.
  UpdateAllowlists: {
    decompose: (vars) => {
      const { additions = [], removals = [], accountAdditions = [], accountRemovals = [], ...baseVars } = vars;
      return [
        ...removals.map((r) => ({ action: 'RemoveFromWhitelist', vars: { ...baseVars, permitted: r } })),
        ...additions.map((a) => ({ action: 'Whitelist', vars: { ...baseVars, permitted: a } })),
        ...accountAdditions.map((a) => ({ action: 'WhitelistAccount', vars: { ...baseVars, permitted: a } })),
        ...accountRemovals.map((r) => ({ action: 'RemoveAccountFromWhitelist', vars: { ...baseVars, permitted: r } }))
      ];
    }
  },
  // InitializeAndManageAsteroid decomposes into [InitializeAsteroid, ManageAsteroid]
  InitializeAndManageAsteroid: {
    decompose: (vars) => [
      { action: 'InitializeAsteroid', vars },
      { action: 'ManageAsteroid', vars }
    ]
  },
  // InitializeAndPurchaseAsteroid decomposes into [InitializeAsteroid, PurchaseAsteroid]
  InitializeAndPurchaseAsteroid: {
    decompose: (vars) => [
      { action: 'InitializeAsteroid', vars },
      { action: 'PurchaseAsteroid', vars }
    ]
  },
  // InitializeAndClaimPrepareForLaunchReward decomposes into [InitializeAsteroid, ClaimPrepareForLaunchReward]
  InitializeAndClaimPrepareForLaunchReward: {
    decompose: (vars) => [
      { action: 'InitializeAsteroid', vars },
      { action: 'ClaimPrepareForLaunchReward', vars }
    ]
  },
  // FinishAllReady decomposes the finishCalls array into individual action calls
  FinishAllReady: {
    decompose: (vars) => {
      const { finishCalls = [] } = vars;
      return finishCalls.map(({ key, vars: callVars }) => ({
        action: key,
        vars: callVars
      }));
    }
  }
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
    // ── Batch / virtual action unwrap ───────────────────────────────
    const batchConfig = BATCH_ACTIONS[action];
    if (batchConfig) {
      let calls;

      if (batchConfig.decompose) {
        // Virtual action with custom decomposition (e.g. UpdatePolicy, UpdateAllowlists)
        calls = batchConfig.decompose(vars);
      } else {
        // Batch action: same handler for each element in the vars array
        const varSets = Array.isArray(vars) ? vars : [vars];
        const isCancellation = batchConfig.getCancelFlag?.(meta);
        const targetAction = isCancellation && batchConfig.cancelHandler
          ? batchConfig.cancelHandler
          : batchConfig.handler;
        calls = varSets.map((varSet) => ({ action: targetAction, vars: varSet }));
      }

      const results = [];
      for (const call of calls) {
        // eslint-disable-next-line no-await-in-loop
        const result = await this.execute({
          action: call.action,
          address,
          callerCrew: callerCrew || call.vars.caller_crew,
          vars: call.vars,
          meta,
          idempotencyKey: idempotencyKey
            ? `${idempotencyKey}-${results.length}`
            : undefined
        });
        results.push(result);
      }
      return results.length === 1 ? results[0] : results;
    }

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
      logger.info(`Side effect phase completed for ${action}`);
    } catch (error) {
      logger.error(`Side effect phase failed for ${action}: ${error.message}`);
      logger.error(error.stack);
    }

    // 3. Emit Socket.IO events (skip in hybrid mode — the client handles
    //    query invalidation directly after the POST response returns)
    if (!isHybrid()) {
      try {
        await handler.emitEvents();
      } catch (error) {
        logger.error(`Socket event emission failed for ${action}:`, error);
      }
    }

    return result;
  }
}

module.exports = GameEngine;
