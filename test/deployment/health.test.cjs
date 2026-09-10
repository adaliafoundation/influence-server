const { test } = require('node:test');
const assert = require('node:assert/strict');
const Koa = require('koa');
const request = require('supertest');
const { createReadiness, createWorkerHealth, isWorkerHealthy, workerKey, boundedProbe,
  healthSettings, WORKER_ROLES } = require('../../src/common/lib/health');
const healthMiddleware = require('../../src/api/plugins/healthMiddleware');
const settings = { namespace: 'production', release: 'sha', timeoutMs: 20, workerMaxAgeMs: 1000,
  requiredWorkers: WORKER_ROLES };

test('worker readiness requires successful progress, expires, and isolates release/environment/instance', async () => {
  const records = new Map();
  const collection = { async updateOne(filter, update) { records.set(filter._id, update.$set); } };
  let time = 100;
  for (const role of WORKER_ROLES) {
    const worker = createWorkerHealth({ collection, settings, role, instance: 'worker-1', now: () => new Date(time) });
    const key = workerKey(settings, role);
    assert.equal(isWorkerHealthy(records.get(key), settings, time), false);
    await worker.starting();
    assert.equal(isWorkerHealthy(records.get(key), settings, time), false);
    await worker.healthy();
    assert.equal(isWorkerHealthy(records.get(key), settings, time, 'worker-1'), true);
    assert.equal(isWorkerHealthy(records.get(key), settings, time, 'worker-2'), false);
    assert.equal(isWorkerHealthy(records.get(key), settings, time - 1), false);
    assert.equal(isWorkerHealthy(records.get(key), settings, time + 1000), false);
    assert.equal(records.get(workerKey({ ...settings, release: 'old' }, role)), undefined);
    assert.equal(records.get(workerKey({ ...settings, namespace: 'prerelease' }, role)), undefined);
    await worker.failed();
    assert.equal(isWorkerHealthy(records.get(key), settings, time), false);
    time += 1;
    await worker.healthy();
    assert.equal(isWorkerHealthy(records.get(key), settings, time), true);
    await worker.starting();
    assert.equal(isWorkerHealthy(records.get(key), settings, time), false);
  }
});

test('optional workers do not write health records in prerelease', async () => {
  const worker = createWorkerHealth({ collection: { updateOne() { throw new Error('unexpected write'); } },
    settings: { ...settings, requiredWorkers: [] }, role: 'event-processor' });
  await worker.starting(); await worker.healthy(); await worker.failed();
});

test('readiness fails for each dependency/worker, recovers, and exposes no upstream errors', async () => {
  const state = Object.fromEntries(['mongodb', 'redis', 'elasticsearch', ...WORKER_ROLES].map((name) => [name, true]));
  const readiness = createReadiness({ timeoutMs: 20, checks: Object.fromEntries(Object.keys(state).map((name) =>
    [name, async () => { if (!state[name]) throw new Error('mongodb://secret:password@private'); return true; }])) });
  const app = new Koa();
  app.use(healthMiddleware(readiness));
  app.use((ctx) => { ctx.status = 401; });
  for (const name of Object.keys(state)) {
    state[name] = false;
    const response = await request(app.callback()).get('/readyz').expect(503);
    assert.equal(response.body.checks[name], false);
    assert.doesNotMatch(response.text, /secret|password|private/);
    await request(app.callback()).get('/livez').expect(200);
    state[name] = true;
    await request(app.callback()).get('/readyz').expect(200);
  }
  await request(app.callback()).head('/readyz').expect(200);
  await request(app.callback()).get('/anything').expect(401);
});

test('timeout bounds responses and shares hanging operations instead of queueing more', async () => {
  let calls = 0;
  let finish;
  const probe = boundedProbe(() => { calls += 1; return new Promise((resolve) => { finish = resolve; }); }, 10);
  assert.deepEqual(await Promise.all([probe(), probe(), probe()]), [false, false, false]);
  assert.equal(await probe(), false);
  assert.equal(calls, 1);
  finish(true);
  await new Promise((resolve) => setImmediate(resolve));
  const next = probe();
  await new Promise((resolve) => setImmediate(resolve));
  finish(true);
  assert.equal(await next, true);
  assert.equal(calls, 2);
});

test('health settings reject invalid thresholds and unsupported worker roles', () => {
  const config = { Health: settings, util: { getEnv: () => 'production' } };
  assert.deepEqual(healthSettings(config), settings);
  for (const patch of [{ timeoutMs: 0 }, { workerMaxAgeMs: 1 }, { requiredWorkers: ['unknown'] }]) {
    assert.throws(() => healthSettings({ ...config, Health: { ...settings, ...patch } }), /Invalid health/);
  }
});
