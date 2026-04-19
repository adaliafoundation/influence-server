/**
 * Build a per-wallet starter loadout — a crew with one crewmate of each
 * real class (Pilot, Engineer, Miner, Merchant, Scientist), a ship, ten
 * operational buildings (one of each type) on asteroid 1, and a small
 * private asteroid on an orbit close to asteroid 1 for short transit
 * practice. This is used by the `--wallets` mode of loadSeedData.js to
 * drop multiple players into the hybrid world at once.
 *
 * Layout (per wallet index N, 0-based):
 *
 *   Asteroid        : id = ASTEROID_BASE + N  (owned, small, near asteroid 1)
 *   Crew            : id = CREW_BASE     + N  (delegated to the wallet)
 *   Crewmates       : id = CREWMATE_BASE + N*5 .. N*5 + 4 (one per class 1..5)
 *   Ship            : id = SHIP_BASE     + N  (docked at their Spaceport)
 *   Buildings       : id = BUILDING_BASE + N*10 .. N*10 + 9
 *                     on asteroid 1, at lots (N+1)*100 + 0..9
 *
 * Building layout (building-index → type):
 *   0: Warehouse         type 1   (stocked with construction materials + food)
 *   1: Extractor         type 2
 *   2: Refinery          type 3
 *   3: Factory           type 5
 *   4: Shipyard          type 6
 *   5: Bioreactor        type 4
 *   6: Marketplace       type 8   (no orders)
 *   7: Habitat           type 9   (crew stationed here)
 *   8: Spaceport         type 7   (ship docked here)
 *   9: Tank Farm         type 10  (fluids: Hydrogen Propellant)
 *
 * ID ranges avoid collision with:
 *   - The base seed (IDs 1-11)
 *   - Locally-generated IDs (start at 100_000_001 — see IdGenerator).
 */

const WALLET_BASE = 1000; // base offset for wallet-generated entity IDs

const ASTEROID_BASE = WALLET_BASE; // small private asteroid per wallet
const CREW_BASE = WALLET_BASE;
// Each wallet gets one crewmate of every real class (PILOT .. SCIENTIST = 1..5),
// so IDs are allocated in blocks of CREWMATE_CLASSES.length per wallet.
const CREWMATE_BASE = WALLET_BASE;
const CREWMATE_CLASSES = [1, 2, 3, 4, 5]; // Pilot, Engineer, Miner, Merchant, Scientist
const SHIP_BASE = WALLET_BASE;
const BUILDING_BASE = WALLET_BASE;

// Asteroid 1's orbit, copied from test/seed/data.json so we can perturb it
// per wallet without an extra JSON read. Keep this in sync if data.json's
// asteroid 1 orbit ever changes.
const AST1_ORBIT = {
  a: 409150176.4,
  ecc: 0.0791,
  inc: 0.1803,
  raan: 1.2915,
  argp: 4.8518,
  m: 3.8671
};

// Match the on-chain encoding used everywhere else: Lot ID = (lotIndex << 32) | asteroidId.
function lotId(asteroidId, lotIndex) {
  return (lotIndex * 4294967296) + asteroidId;
}

// ─── Building templates ─────────────────────────────────────────────────────
// Ten types, one of each. Every building is OPERATIONAL with plannedAt +
// finishTime in the past so they're ready to use immediately.
const BUILDING_TEMPLATES = [
  { type: 1, name: 'Warehouse' },
  { type: 2, name: 'Extractor' },
  { type: 3, name: 'Refinery' },
  { type: 5, name: 'Factory' },
  { type: 6, name: 'Shipyard' },
  { type: 4, name: 'Bioreactor' },
  { type: 8, name: 'Marketplace' },
  { type: 9, name: 'Habitat' },
  { type: 7, name: 'Spaceport' },
  { type: 10, name: 'Tank Farm' }
];

// Indices (0-based) into BUILDING_TEMPLATES for constructs that need special
// sub-components — used to keep the logic declarative below.
const IDX_WAREHOUSE = 0;
const IDX_EXTRACTOR = 1;
const IDX_REFINERY = 2;
const IDX_FACTORY = 3;
const IDX_SHIPYARD = 4;
const IDX_BIOREACTOR = 5;
const IDX_MARKETPLACE = 6;
const IDX_HABITAT = 7;
const IDX_SPACEPORT = 8;
const IDX_TANK_FARM = 9;

// Starter warehouse stock (slot 2, Warehouse Storage type 10).
// Enough for the initial sampling + a small-building build.
const WAREHOUSE_STOCK = [
  { product: 44, amount: 50000 }, // Cement — 50t
  { product: 69, amount: 30000 }, // Steel Beam — 30t
  { product: 70, amount: 30000 }, // Steel Sheet — 30t
  { product: 52, amount: 30000 }, // Steel — 30t
  { product: 29, amount: 30000 }, // Iron — 30t
  { product: 30, amount: 20000 }, // Copper — 20t
  { product: 129, amount: 10000 }, // Food — 10t
  { product: 175, amount: 5 } // Core Drill x5
];

// Tank farm fluids (slot 2, Fluids Storage type 19).
const TANK_FARM_STOCK = [
  { product: 170, amount: 1000000 } // Hydrogen Propellant — 1kt
];

/** Return the mass sum of a contents list using @influenceth/sdk Product table. */
function contentsMass(contents, Product) {
  return contents.reduce((acc, c) => acc + (Product.TYPES[c.product]?.massPerUnit || 0) * c.amount, 0);
}

/** Return the volume sum of a contents list. */
function contentsVolume(contents, Product) {
  return contents.reduce((acc, c) => acc + (Product.TYPES[c.product]?.volumePerUnit || 0) * c.amount, 0);
}

/**
 * Build one wallet's entity + component docs.
 *
 * @param {object} params
 * @param {string} params.walletAddress - normalized (Address.toStandard) starknet address
 * @param {number} params.index - zero-based wallet index; controls ID / lot offsets
 * @param {object} params.sdk - `{ Product, Entity }` from @influenceth/sdk (passed in to
 *                              avoid requiring the SDK at module load time).
 * @returns {object} loadout `{ entities, nftComponents, celestialComponents, orbitComponents,
 *                              nameComponents, crewComponents, crewmateComponents,
 *                              locationComponents, controlComponents, buildingComponents,
 *                              shipComponents, inventoryComponents, stationComponents,
 *                              dockComponents, extractorComponents, processorComponents,
 *                              dryDockComponents, exchangeComponents }`
 */
function buildWalletLoadout({ walletAddress, index, sdk }) {
  const { Product } = sdk;

  const asteroidId = ASTEROID_BASE + index;
  const crewId = CREW_BASE + index;
  // Allocate five crewmate IDs per wallet — one for each real class.
  // ID layout: CREWMATE_BASE + index*5 + classOffset, where classOffset
  // is 0..4 matching CREWMATE_CLASSES. IDs don't collide with crew / ship
  // (different label) or with base-seed crewmates (IDs 1-5).
  const crewmateIds = CREWMATE_CLASSES.map(
    (_, i) => CREWMATE_BASE + (index * CREWMATE_CLASSES.length) + i
  );
  const shipId = SHIP_BASE + index;
  const buildingIds = Array.from({ length: 10 }, (_, i) => BUILDING_BASE + (index * 10) + i);

  // Base lot index for this wallet's row of buildings on asteroid 1.
  // Wallet 0 → 100, wallet 1 → 200, wallet 2 → 300, etc. Each building
  // sits one lot apart so one wallet occupies [base, base+9].
  const lotBase = (index + 1) * 100;

  // Tiny orbital perturbation — keep almost the same orbit as asteroid 1
  // so transit distance is minimal.
  const orbit = {
    a: AST1_ORBIT.a,
    ecc: AST1_ORBIT.ecc,
    inc: AST1_ORBIT.inc,
    raan: AST1_ORBIT.raan,
    argp: AST1_ORBIT.argp,
    // Offset the phase slightly so the two asteroids aren't co-located.
    // 0.0002 rad × 409M km radius ≈ 80k km offset — a few minutes of transit.
    m: AST1_ORBIT.m + 0.0002 * (index + 1)
  };

  // ── Entities ────────────────────────────────────────────────────────────
  const entities = [
    { id: asteroidId, label: 3 }, // Asteroid
    { id: crewId, label: 1 }, // Crew
    ...crewmateIds.map((id) => ({ id, label: 2 })), // Crewmates (one per class)
    { id: shipId, label: 6 }, // Ship
    ...buildingIds.map((id) => ({ id, label: 5 })) // Buildings
  ];

  // Lot entities: the 10 occupied lots on asteroid 1.
  // Lots live in their own label (4) so they need Entity rows too.
  for (let i = 0; i < 10; i++) {
    entities.push({ id: lotId(1, lotBase + i), label: 4 });
  }

  // ── NFT ownership ───────────────────────────────────────────────────────
  // Crew, crewmates, asteroid, and ship are NFTs; they're owned by the wallet.
  // Buildings are controlled by the crew (no separate NFT).
  const nftComponents = [
    { entity: { id: asteroidId, label: 3 }, owners: { starknet: walletAddress } },
    { entity: { id: crewId, label: 1 }, owners: { starknet: walletAddress } },
    ...crewmateIds.map((id) => ({ entity: { id, label: 2 }, owners: { starknet: walletAddress } })),
    { entity: { id: shipId, label: 6 }, owners: { starknet: walletAddress } }
  ];

  // ── Celestial + Orbit for the small asteroid ────────────────────────────
  const celestialComponents = [
    {
      entity: { id: asteroidId, label: 3 },
      celestialType: 1,
      // Small asteroid: ~60% of asteroid 1's radius (375 → 225 km).
      // Real surface area scales by r², so the lot count is much smaller;
      // that's fine — we only place buildings at specific lot indices.
      mass: 1000000000,
      radius: 225,
      // SURFACE_SCANNED = 3 so TransitBetweenStart accepts it as a destination.
      // (Resource-scan would let players prospect there — out of scope here.)
      scanStatus: 3,
      bonuses: 0,
      abundances: '0x00'
    }
  ];
  const orbitComponents = [{ entity: { id: asteroidId, label: 3 }, ...orbit }];

  // ── Names (optional but makes the UI friendly) ──────────────────────────
  const nameComponents = [
    { entity: { id: asteroidId, label: 3 }, name: `Wallet ${index + 1} Asteroid` },
    { entity: { id: crewId, label: 1 }, name: `Wallet ${index + 1} Crew` },
    { entity: { id: shipId, label: 6 }, name: `Wallet ${index + 1} Ship` }
  ];

  // ── Crew + crewmates ────────────────────────────────────────────────────
  const crewComponents = [
    {
      entity: { id: crewId, label: 1 },
      delegatedTo: walletAddress,
      readyAt: 0,
      lastFed: 9999999999, // never starve during dev testing
      roster: crewmateIds, // all five classes on one crew
      actionType: 0,
      actionRound: 0
    }
  ];
  // One crewmate per real class (Pilot, Engineer, Miner, Merchant, Scientist) so
  // the crew is eligible for every class-gated bonus (miner for sample yield,
  // engineer for construction, etc.). Cosmetic and impactful attributes are
  // copied from the base seed's crewmate 1 — the values aren't meaningful for
  // dev play, they just satisfy the schema.
  const crewmateComponents = crewmateIds.map((id, i) => ({
    entity: { id, label: 2 },
    class: CREWMATE_CLASSES[i],
    title: 0,
    status: 1,
    coll: 1,
    impactful: [1, 2, 3, 4, 5, 6],
    cosmetic: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
  }));

  // ── Building rows ───────────────────────────────────────────────────────
  const buildingComponents = buildingIds.map((id, i) => ({
    entity: { id, label: 5 },
    buildingType: BUILDING_TEMPLATES[i].type,
    status: 3, // OPERATIONAL
    plannedAt: 1700000000,
    finishTime: 1700001000
  }));

  // Location: each building on a distinct lot on asteroid 1.
  const locationComponents = buildingIds.map((id, i) => ({
    entity: { id, label: 5 },
    location: { id: lotId(1, lotBase + i), label: 4 },
    locations: [
      { id: lotId(1, lotBase + i), label: 4 },
      { id: 1, label: 3 } // asteroid 1
    ]
  }));

  // Crew sits at their own Habitat, ship docks at their own Spaceport.
  const habitatId = buildingIds[IDX_HABITAT];
  const habitatLot = lotId(1, lotBase + IDX_HABITAT);
  const spaceportId = buildingIds[IDX_SPACEPORT];

  locationComponents.push({
    entity: { id: crewId, label: 1 },
    location: { id: habitatId, label: 5 },
    locations: [
      { id: habitatId, label: 5 },
      { id: habitatLot, label: 4 },
      { id: 1, label: 3 }
    ]
  });

  for (const cmId of crewmateIds) {
    locationComponents.push({
      entity: { id: cmId, label: 2 },
      location: { id: crewId, label: 1 },
      locations: [
        { id: crewId, label: 1 },
        { id: habitatId, label: 5 },
        { id: habitatLot, label: 4 },
        { id: 1, label: 3 }
      ]
    });
  }

  locationComponents.push({
    entity: { id: shipId, label: 6 },
    location: { id: spaceportId, label: 5 },
    locations: [
      { id: spaceportId, label: 5 },
      { id: lotId(1, lotBase + IDX_SPACEPORT), label: 4 },
      { id: 1, label: 3 }
    ]
  });

  // The wallet's private asteroid sits in space — no lot/building.
  locationComponents.push({
    entity: { id: asteroidId, label: 3 },
    location: null,
    locations: []
  });

  // ── Control: crew controls every owned asset ────────────────────────────
  const controlComponents = [
    { entity: { id: asteroidId, label: 3 }, controller: { id: crewId, label: 1 } },
    { entity: { id: shipId, label: 6 }, controller: { id: crewId, label: 1 } },
    ...buildingIds.map((id) => ({ entity: { id, label: 5 }, controller: { id: crewId, label: 1 } }))
  ];

  // ── Ship ────────────────────────────────────────────────────────────────
  const shipComponents = [
    {
      entity: { id: shipId, label: 6 },
      shipType: 2, // Light Transport
      status: 1, // AVAILABLE
      variant: 1, // STANDARD
      readyAt: 0,
      emergencyAt: 0,
      transitDeparture: 0,
      transitArrival: 0,
      transitOrigin: null,
      transitDestination: null
    }
  ];

  // ── Inventories ─────────────────────────────────────────────────────────
  // Warehouse: empty site slot 1, stocked storage slot 2.
  // Extractor / Refinery / Factory / Shipyard / Bioreactor / Marketplace /
  // Habitat / Spaceport: buildings built, operational — site slot 1 empty
  // (content consumed during construction), no operational inventory unless
  // the building has one (handled per-type below).
  // Tank Farm: slot 1 empty site, slot 2 fluids.
  const inventoryComponents = [];

  const pushInv = (id, slot, type, status, contents = []) => {
    inventoryComponents.push({
      entity: { id, label: 5 },
      inventoryType: type,
      slot,
      status,
      mass: contentsMass(contents, Product),
      volume: contentsVolume(contents, Product),
      reservedMass: 0,
      reservedVolume: 0,
      contents
    });
  };

  // Warehouse
  pushInv(buildingIds[IDX_WAREHOUSE], 1, 1, 0, []); // site (disabled, empty)
  pushInv(buildingIds[IDX_WAREHOUSE], 2, 10, 1, WAREHOUSE_STOCK); // storage

  // Tank Farm
  pushInv(buildingIds[IDX_TANK_FARM], 1, 18, 0, []); // site
  pushInv(buildingIds[IDX_TANK_FARM], 2, 19, 1, TANK_FARM_STOCK); // fluids

  // Ship: two inventories (propellant tank + cargo hold). Light Transport
  // uses propellant type 13 / cargo type 16 (matches ship 1 in seed).
  inventoryComponents.push({
    entity: { id: shipId, label: 6 },
    inventoryType: 13,
    slot: 1,
    status: 1,
    mass: 0, volume: 0, reservedMass: 0, reservedVolume: 0,
    contents: []
  });
  inventoryComponents.push({
    entity: { id: shipId, label: 6 },
    inventoryType: 16,
    slot: 2,
    status: 1,
    mass: 0, volume: 0, reservedMass: 0, reservedVolume: 0,
    contents: []
  });

  // ── Station (Habitat) ───────────────────────────────────────────────────
  const stationComponents = [
    { entity: { id: habitatId, label: 5 }, stationType: 3, population: 0 }
  ];

  // ── Dock (Spaceport) — 1 ship docked ────────────────────────────────────
  const dockComponents = [
    { entity: { id: spaceportId, label: 5 }, dockType: 1, dockedShips: 1 }
  ];

  // ── Extractor / Processor / DryDock slots (idle) ────────────────────────
  const extractorComponents = [
    { entity: { id: buildingIds[IDX_EXTRACTOR], label: 5 }, slot: 1, status: 0, outputProduct: 0, yield: 0, finishTime: 0 }
  ];
  const processorComponents = [
    { entity: { id: buildingIds[IDX_REFINERY], label: 5 }, slot: 1, processorType: 1, status: 0, outputProduct: 0, recipes: 0, runningProcess: 0, secondaryEff: 0, finishTime: 0 },
    { entity: { id: buildingIds[IDX_FACTORY], label: 5 }, slot: 1, processorType: 2, status: 0, outputProduct: 0, recipes: 0, runningProcess: 0, secondaryEff: 0, finishTime: 0 },
    { entity: { id: buildingIds[IDX_BIOREACTOR], label: 5 }, slot: 1, processorType: 3, status: 0, outputProduct: 0, recipes: 0, runningProcess: 0, secondaryEff: 0, finishTime: 0 }
  ];
  const dryDockComponents = [
    { entity: { id: buildingIds[IDX_SHIPYARD], label: 5 }, slot: 1, status: 0, outputProduct: 0, finishTime: 0 }
  ];

  // ── Exchange (Marketplace) — no orders ──────────────────────────────────
  // Start with no allowed products so orders can't be placed until the
  // player configures it — deliberately empty per spec.
  const exchangeComponents = [
    {
      entity: { id: buildingIds[IDX_MARKETPLACE], label: 5 },
      exchangeType: 1,
      makerFee: 0,
      takerFee: 0,
      orders: 0,
      allowedProducts: []
    }
  ];

  return {
    entities,
    nftComponents,
    celestialComponents,
    orbitComponents,
    nameComponents,
    crewComponents,
    crewmateComponents,
    locationComponents,
    controlComponents,
    buildingComponents,
    shipComponents,
    inventoryComponents,
    stationComponents,
    dockComponents,
    extractorComponents,
    processorComponents,
    dryDockComponents,
    exchangeComponents
  };
}

/**
 * Merge an array of per-wallet loadouts into a single bag of arrays ready
 * for the existing loader path in loadSeedData.js.
 */
function mergeLoadouts(loadouts) {
  const merged = {};
  for (const loadout of loadouts) {
    for (const [key, arr] of Object.entries(loadout)) {
      if (!merged[key]) merged[key] = [];
      merged[key].push(...arr);
    }
  }
  return merged;
}

module.exports = { buildWalletLoadout, mergeLoadouts, WALLET_BASE };
