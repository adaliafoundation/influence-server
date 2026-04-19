const appConfig = require('config');
const KoaRouter = require('@koa/router');
const cors = require('@koa/cors');
const koaJwt = require('koa-jwt');
const bodyParser = require('koa-bodyparser');
const corsOrJwt = require('@api/plugins/corsOrJwt');
const { allowedOrigin } = require('@api/plugins/origin');
const { client: esClient } = require('@common/storage/elasticsearch');
const { isHybrid } = require('@common/lib/gameMode');
const { ComponentService, EntityService } = require('@common/services');
const logger = require('@common/lib/logger');

// Map ES index names to entity labels
const INDEX_TO_LABEL = {
  asteroid: 3,
  crew: 1,
  crewmate: 2,
  building: 5,
  ship: 6,
  deposit: 7,
  delivery: 9,
  lot: 4
};

/**
 * Resolve a dotted path (e.g. "Building.status") against an object.
 */
function getNestedValue(obj, path) {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}

/**
 * Build a single predicate from a bool query object.
 * Handles should (OR), must/filter (AND), and must_not (NOT) at any nesting depth.
 */
function buildBoolPredicate(query) {
  if (!query?.bool) return null;
  const andPreds = extractPredicates(query); // handles must, filter, must_not
  const shouldClauses = Array.isArray(query.bool.should)
    ? query.bool.should
    : (query.bool.should ? [query.bool.should] : []);

  // Build OR predicates from should clauses
  const orPreds = [];
  for (const clause of shouldClauses) {
    if (clause.bool) {
      const sub = buildBoolPredicate(clause);
      if (sub) orPreds.push(sub);
    } else {
      // Wrap the single clause in a bool.filter so extractPredicates can handle it
      const wrapped = extractPredicates({ bool: { filter: [clause] } });
      if (wrapped.length > 0) {
        orPreds.push((entity) => wrapped.every((p) => p(entity)));
      }
    }
  }

  const parts = [];
  if (andPreds.length > 0) parts.push((entity) => andPreds.every((p) => p(entity)));
  if (orPreds.length > 0) parts.push((entity) => orPreds.some((p) => p(entity)));

  if (parts.length === 0) return null;
  return (entity) => parts.every((p) => p(entity));
}

/**
 * Extract simple filter predicates from an ES bool query.
 * Returns an array of predicate functions that each entity must satisfy.
 */
function extractPredicates(query) {
  const predicates = [];
  if (!query?.bool) return predicates;

  const clauses = [
    ...(Array.isArray(query.bool.filter) ? query.bool.filter : (query.bool.filter ? [query.bool.filter] : [])),
    ...(Array.isArray(query.bool.must) ? query.bool.must : (query.bool.must ? [query.bool.must] : []))
  ];

  for (const clause of clauses) {
    // { term: { "Building.status": 3 } }
    if (clause.term) {
      const [field, value] = Object.entries(clause.term)[0];
      // eslint-disable-next-line eqeqeq
      predicates.push((entity) => getNestedValue(entity, field) == value);
    }

    // { terms: { "product": [1, 2, 3] } }
    if (clause.terms) {
      const [field, values] = Object.entries(clause.terms)[0];
      if (Array.isArray(values)) {
        // eslint-disable-next-line eqeqeq
        predicates.push((entity) => values.some((v) => v == getNestedValue(entity, field)));
      }
    }

    // { exists: { field: "Dock" } }
    if (clause.exists) {
      const field = clause.exists.field;
      predicates.push((entity) => {
        const val = getNestedValue(entity, field);
        if (val == null) return false;
        if (Array.isArray(val) && val.length === 0) return false;
        return true;
      });
    }

    // { range: { "finishTime": { lte: 12345 } } }
    if (clause.range) {
      const [field, ops] = Object.entries(clause.range)[0];
      predicates.push((entity) => {
        const val = getNestedValue(entity, field);
        if (val == null) return false;
        if (ops.gt !== undefined && !(val > ops.gt)) return false;
        if (ops.gte !== undefined && !(val >= ops.gte)) return false;
        if (ops.lt !== undefined && !(val < ops.lt)) return false;
        if (ops.lte !== undefined && !(val <= ops.lte)) return false;
        return true;
      });
    }

    // { nested: { path: "Location.locations", query: { bool: ... } } }
    if (clause.nested) {
      const { path, query: nestedQuery } = clause.nested;
      const nestedPred = buildBoolPredicate(nestedQuery);
      if (nestedPred) {
        predicates.push((entity) => {
          const arr = getNestedValue(entity, path);
          if (!Array.isArray(arr)) return false;
          // At least one element must satisfy the nested query.
          // Wrap each item so full paths (e.g. "Location.locations.id") resolve correctly.
          const parts = path.split('.');
          return arr.some((item) => {
            let wrapper = item;
            for (let i = parts.length - 1; i >= 0; i--) {
              wrapper = { [parts[i]]: wrapper };
            }
            return nestedPred(wrapper);
          });
        });
      }
    }

    // { bool: { should: [...], must: [...], filter: [...], must_not: [...] } }
    // A nested bool inside a filter/must acts as a sub-query.
    // should = OR (at least one must match), must/filter = AND, must_not = NOT
    if (clause.bool) {
      const subPred = buildBoolPredicate(clause);
      if (subPred) predicates.push(subPred);
    }
  }

  // { must_not: [...] }
  if (query.bool.must_not) {
    const mustNotClauses = Array.isArray(query.bool.must_not) ? query.bool.must_not : [query.bool.must_not];
    for (const clause of mustNotClauses) {
      if (clause.term) {
        const [field, value] = Object.entries(clause.term)[0];
        // eslint-disable-next-line eqeqeq
        predicates.push((entity) => getNestedValue(entity, field) != value);
      }
      if (clause.terms) {
        const [field, values] = Object.entries(clause.terms)[0];
        if (Array.isArray(values)) {
          // eslint-disable-next-line eqeqeq
          predicates.push((entity) => !values.some((v) => v == getNestedValue(entity, field)));
        }
      }
    }
  }

  return predicates;
}

/**
 * Fetch all orders from MongoDB, enriched with location data (like the ES formatter).
 */
async function fetchOrders() {
  const { omit } = require('lodash'); // eslint-disable-line global-require
  const orders = await ComponentService.model('Order').find({}).lean();
  const locationCache = {};

  const enriched = [];
  for (const order of orders) {
    const entityUuid = order.entity?.uuid;
    if (!entityUuid) continue;

    // Cache location lookups per exchange building
    if (!locationCache[entityUuid]) {
      const loc = await ComponentService.findOneByEntity('Location', order.entity);
      locationCache[entityUuid] = loc?.locations || [];
    }

    const formatted = omit(order, ['__v', '_id', 'entities', 'event']);
    formatted.locations = [...locationCache[entityUuid], order.entity];
    enriched.push(formatted);
  }
  return enriched;
}

/**
 * Enrich entity results with `meta` fields (resolved names of related entities).
 * ES formatters normally do this per-entity at index time; here we batch it.
 */
async function enrichWithMeta(entities) {
  if (!entities || entities.length === 0) return entities;

  // Collect all entity refs that need name resolution
  const nameRefs = new Map(); // uuid → { id, label }
  for (const e of entities) {
    const locs = e.Location?.locations || [];
    for (const loc of locs) {
      if (loc.uuid && (loc.label === 3 || loc.label === 5)) { // asteroid or building
        nameRefs.set(loc.uuid, loc);
      }
    }
    if (e.Control?.controller?.uuid) {
      nameRefs.set(e.Control.controller.uuid, e.Control.controller);
    }
  }

  // Batch fetch names
  const nameMap = {};
  if (nameRefs.size > 0) {
    const NameModel = ComponentService.model('Name');
    const nameDocs = await NameModel.find({
      'entity.uuid': { $in: [...nameRefs.keys()] }
    }).lean();
    for (const doc of nameDocs) {
      nameMap[doc.entity.uuid] = doc.name;
    }
  }

  // Attach meta to each entity
  const { Entity } = require('@influenceth/sdk'); // eslint-disable-line global-require
  return entities.map((e) => {
    const locs = e.Location?.locations || [];
    const asteroidLoc = locs.find((l) => l.label === Entity.IDS.ASTEROID);
    const buildingLoc = locs.find((l) => l.label === Entity.IDS.BUILDING);
    const crewRef = e.Control?.controller;

    e.meta = {
      asteroid: { name: (asteroidLoc?.uuid && nameMap[asteroidLoc.uuid]) || null },
      building: { name: (buildingLoc?.uuid && nameMap[buildingLoc.uuid]) || null },
      crew: { name: (crewRef?.uuid && nameMap[crewRef.uuid]) || null }
    };
    return e;
  });
}

// Hard cap on rows materialized in-process per request. Lot label (4) on a
// fully-forked asteroid has ~1.7M docs; a pure in-memory search on that would
// blow RSS and stall the event loop. This bounds every request.
const HYBRID_SEARCH_HARD_LIMIT = 10000;

const hybridSearch = async function (ctx) {
  const { params: { index }, request: { body } } = ctx;
  if (!index) ctx.throw(404, 'Missing or invalid index');

  let results;
  if (index === 'order') {
    results = await fetchOrders();
  } else {
    const label = INDEX_TO_LABEL[index];
    if (!label) {
      ctx.body = { hits: { hits: [], total: { value: 0 } } };
      return;
    }
    // Refuse unfiltered label-only queries that would load everything.
    if (!body?.query && label === INDEX_TO_LABEL.lot) {
      ctx.status = 400;
      ctx.body = { error: 'lot searches require a query filter' };
      return;
    }
    results = await EntityService.getEntities({ label, format: true });
    if ((results || []).length > HYBRID_SEARCH_HARD_LIMIT) {
      logger.warn(`hybridSearch [${index}]: truncating ${results.length} → ${HYBRID_SEARCH_HARD_LIMIT} rows`);
      results = results.slice(0, HYBRID_SEARCH_HARD_LIMIT);
    }
    // Enrich entities with meta fields (names of related entities) that the
    // ES formatters normally provide. Without these, list views crash.
    results = await enrichWithMeta(results);
  }
  const totalBefore = (results || []).length;

  // Apply ES query filters
  if (body?.query) {
    const predicate = buildBoolPredicate(body.query);
    if (predicate) {
      results = (results || []).filter(predicate);
      logger.debug(`hybridSearch [${index}]: ${totalBefore} -> ${results.length}`);
    }
  }

  // Apply aggregations
  let aggregations;
  if (body?.aggs) {
    aggregations = processAggregations(body.aggs, results || []);
  }

  // Apply pagination
  const from = body?.from || 0;
  const size = body?.size || 10000;
  const paginated = (results || []).slice(from, from + size);

  ctx.body = {
    hits: {
      hits: paginated.map((r) => ({ _source: r })),
      total: { value: (results || []).length }
    },
    ...(aggregations ? { aggregations } : {})
  };
};

/**
 * Process ES-style aggregations against an in-memory array of documents.
 * Supports: terms, filter, sum, min, max.
 */
function processAggregations(aggs, docs) {
  const result = {};
  for (const [name, aggDef] of Object.entries(aggs)) {
    if (aggDef.terms) {
      result[name] = processTermsAgg(aggDef, docs);
    } else if (aggDef.filter) {
      result[name] = processFilterAgg(aggDef, docs);
    } else if (aggDef.sum) {
      result[name] = { value: docs.reduce((s, d) => s + (getNestedValue(d, aggDef.sum.field) || 0), 0) };
    } else if (aggDef.min) {
      const vals = docs.map((d) => getNestedValue(d, aggDef.min.field)).filter((v) => v != null);
      result[name] = { value: vals.length ? Math.min(...vals) : null };
    } else if (aggDef.max) {
      const vals = docs.map((d) => getNestedValue(d, aggDef.max.field)).filter((v) => v != null);
      result[name] = { value: vals.length ? Math.max(...vals) : null };
    }
  }
  return result;
}

function processTermsAgg(aggDef, docs) {
  const field = aggDef.terms.field;
  const groups = {};
  for (const doc of docs) {
    const val = getNestedValue(doc, field);
    if (val == null) continue;
    // ES terms agg on array fields creates one bucket per element
    const keys = Array.isArray(val) ? val : [val];
    for (const key of keys) {
      if (key == null) continue;
      if (!groups[key]) groups[key] = [];
      groups[key].push(doc);
    }
  }

  const buckets = Object.entries(groups).map(([key, groupDocs]) => {
    const bucket = { key: isNaN(key) ? key : Number(key), doc_count: groupDocs.length };
    if (aggDef.aggs) {
      Object.assign(bucket, processAggregations(aggDef.aggs, groupDocs));
    }
    return bucket;
  });

  return { buckets };
}

function processFilterAgg(aggDef, docs) {
  const predicates = buildBoolPredicate(aggDef.filter);
  const filtered = predicates ? docs.filter(predicates) : docs;
  const bucket = { doc_count: filtered.length };
  if (aggDef.aggs) {
    Object.assign(bucket, processAggregations(aggDef.aggs, filtered));
  }
  return bucket;
}

const search = async function (ctx) {
  const { params: { index }, request: { body } } = ctx;
  if (!index) ctx.throw(404, 'Missing or invalid index');
  ctx.body = await esClient.search({ index, body });
};

const router = new KoaRouter({ prefix: '/_search' })
  .use(koaJwt({ secret: appConfig.get('App.jwtSecret'), passthrough: true }))
  .use(cors({ origin: allowedOrigin }))
  .use(corsOrJwt)
  .use(bodyParser())
  .post('/:index', isHybrid() ? hybridSearch : search);

module.exports = router;
