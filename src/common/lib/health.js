const { hostname } = require('os');

const WORKER_ROLES = ['ethereum-retriever', 'starknet-retriever', 'event-processor', 'elastic-indexer'];

function healthSettings(config) {
  const settings = {
    namespace: config.Health.namespace || config.util.getEnv('NODE_ENV'),
    release: config.Health.release,
    timeoutMs: Number(config.Health.timeoutMs),
    workerMaxAgeMs: Number(config.Health.workerMaxAgeMs),
    requiredWorkers: config.Health.requiredWorkers
  };
  if (!settings.namespace || !settings.release
    || !Number.isFinite(settings.timeoutMs) || settings.timeoutMs <= 0
    || !Number.isFinite(settings.workerMaxAgeMs) || settings.workerMaxAgeMs <= settings.timeoutMs
    || !Array.isArray(settings.requiredWorkers)
    || settings.requiredWorkers.some((role) => !WORKER_ROLES.includes(role))) {
    throw new Error('Invalid health configuration');
  }
  return settings;
}

function workerKey(settings, role) {
  return JSON.stringify([settings.namespace, settings.release, role]);
}

function isWorkerHealthy(record, settings, now = Date.now(), instance = undefined) {
  const age = now - new Date(record?.updatedAt).getTime();
  return record?.status === 'ready' && age >= 0 && age < settings.workerMaxAgeMs
    && (!instance || record.instance === instance);
}

function createWorkerHealth({ collection, settings, role, instance = hostname(), now = () => new Date() }) {
  if (!WORKER_ROLES.includes(role)) throw new Error('Invalid worker role');
  const enabled = settings.requiredWorkers.includes(role);
  const update = async (status) => {
    if (!enabled) return;
    await collection.updateOne({ _id: workerKey(settings, role) }, {
      $set: { status, instance, updatedAt: now() }
    }, { upsert: true, maxTimeMS: settings.timeoutMs, timeoutMS: settings.timeoutMs });
  };
  return {
    starting: () => update('starting'),
    healthy: () => update('ready'),
    failed: () => update('failed')
  };
}

// Share an outstanding operation even after its caller times out, avoiding an unbounded
// number of queued driver operations when health checks continue during an outage.
function boundedProbe(check, timeoutMs) {
  let pending;
  return async () => {
    if (!pending) {
      pending = Promise.resolve().then(check).then((value) => value === true, () => false)
        .finally(() => { pending = undefined; });
    }
    let timer;
    try {
      return await Promise.race([
        pending,
        new Promise((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); })
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
}

function createReadiness({ checks, timeoutMs }) {
  const probes = Object.entries(checks).map(([name, check]) => [name, boundedProbe(check, timeoutMs)]);
  return async () => {
    const results = await Promise.all(probes.map(async ([name, probe]) => [name, await probe()]));
    return { ready: results.every(([, ready]) => ready), checks: Object.fromEntries(results) };
  };
}

module.exports = {
  WORKER_ROLES, healthSettings, workerKey, isWorkerHealthy, createWorkerHealth, boundedProbe, createReadiness
};
