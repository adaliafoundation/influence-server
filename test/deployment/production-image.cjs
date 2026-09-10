// Executed inside the final production image by scripts/test-production-image.sh.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawn, spawnSync, execFileSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { mongo: { MongoClient } } = require('mongoose');
const { createClient } = require('redis');
const config = require('config');
const { healthSettings, workerKey, createWorkerHealth, WORKER_ROLES } = require('./src/common/lib/health');

async function waitFor(check, description) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try { if (await check()) return; } catch { /* Dependencies are starting. */ }
    await delay(1000);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function main() {
  assert.equal(process.getuid(), 1000);
  // Recheck the structural assumptions behind the reviewed Perl findings.
  assert.equal(execFileSync('getconf', ['LONG_BIT'], { encoding: 'utf8' }).trim(), '64');
  for (const module of ['Archive::Tar', 'Storable']) {
    const result = spawnSync('perl', [`-M${module}`, '-e', '1'], { encoding: 'utf8' });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Can't locate .* in @INC/);
  }
  for (const path of ['node_modules/nodemon', 'node_modules/mocha', 'node_modules/pm2', '.env', 'test']) {
    assert.equal(fs.existsSync(`/app/${path}`), false, path);
  }
  for (const tool of ['mongodump', 'mongorestore', 'mongoimport', 'npm', 'yarn']) {
    assert.throws(() => execFileSync('sh', ['-c', `command -v ${tool}`]));
  }
  assert.equal(process.env.JWT_SECRET, undefined);
  for (const name of ['MONGO_URL', 'REDIS_URL', 'ELASTICSEARCH_URL']) assert.equal(process.env[name], undefined);
  assert.equal(config.get('App.jwtSecret'), 'smoke-jwt-secret-do-not-log');
  assert.throws(() => fs.writeFileSync('/app/unexpected-write', 'x'));
  const settings = healthSettings(config);
  const client = new MongoClient(config.get('MongoDb.uri'), { serverSelectionTimeoutMS: 2000 });
  const redis = createClient({ url: config.get('Redis.uri'), socket: { reconnectStrategy: false } });
  redis.on('error', () => {});
  let server;
  let logs = '';
  try {
    await waitFor(async () => { await client.connect(); return true; }, 'MongoDB');
    await waitFor(async () => {
      const response = await fetch('http://elasticsearch:9200/_cluster/health', {
        headers: { Authorization: `Basic ${Buffer.from('elastic:smoke-elastic-password').toString('base64')}` },
        signal: AbortSignal.timeout(1000)
      });
      return response.ok;
    }, 'Elasticsearch');
    await redis.connect();
    assert.equal((await fetch('http://elasticsearch:9200')).status, 401);
    const anonymousMongo = new MongoClient('mongodb://mongo:27017/production_smoke');
    try {
      await anonymousMongo.connect();
      await assert.rejects(anonymousMongo.db().collection('workerhealth').findOne({}), /requires authentication|Unauthorized/);
    } finally { await anonymousMongo.close(); }
    const anonymousRedis = createClient({ url: 'redis://redis:6379', socket: { reconnectStrategy: false } });
    anonymousRedis.on('error', () => {});
    try {
      await anonymousRedis.connect();
      await assert.rejects(anonymousRedis.ping(), /NOAUTH/);
    } finally { if (anonymousRedis.isOpen) await anonymousRedis.disconnect(); }
    server = spawn(process.execPath, ['src/api/server.js'], { stdio: ['ignore', 'pipe', 'pipe'] });
    server.stdout.on('data', (chunk) => { logs += chunk; });
    server.stderr.on('data', (chunk) => { logs += chunk; });
    const get = (path) => fetch(`http://127.0.0.1:3001${path}`, { signal: AbortSignal.timeout(4000) });
    await waitFor(async () => (await get('/livez')).ok, 'API startup');
    const initial = await get('/readyz');
    assert.equal(initial.status, 503);
    const initialState = await initial.json();
    assert.equal(initialState.checks.mongodb, true);
    assert.equal(initialState.checks.redis, true);
    assert.equal(initialState.checks.elasticsearch, true);
    const collection = client.db().collection('workerhealth');
    for (const role of WORKER_ROLES) {
      assert.equal(initialState.checks[role], false);
      const health = createWorkerHealth({ collection, settings, role });
      await health.starting();
      assert.equal((await get('/readyz')).status, 503);
      await health.healthy();
    }
    assert.equal((await get('/readyz')).status, 200);
    execFileSync(process.execPath, ['bin/healthcheck.js', 'api']);
    for (const role of WORKER_ROLES) {
      execFileSync(process.execPath, ['bin/healthcheck.js', role]);
      const id = workerKey(settings, role);
      await collection.updateOne({ _id: id }, { $set: { updatedAt: new Date(0) } });
      assert.equal((await get('/readyz')).status, 503);
      await createWorkerHealth({ collection, settings, role }).healthy();
      assert.equal((await get('/readyz')).status, 200);
    }
    // A real Redis command stall must affect readiness but not liveness, then recover.
    await redis.sendCommand(['CLIENT', 'PAUSE', '4000', 'ALL']);
    assert.equal((await get('/readyz')).status, 503);
    assert.equal((await get('/livez')).status, 200);
    await waitFor(async () => (await get('/readyz')).ok, 'Redis recovery');
    await get('/unknown?token=do-not-log-query');
    assert.doesNotMatch(logs, /smoke-(?:jwt-secret-do-not-log|mongo-password|redis-password|elastic-password)|do-not-log-query|mongodb:\/\/|redis:\/\//);
    for (const line of logs.trim().split('\n').filter(Boolean)) JSON.parse(line);
    console.log('Production image smoke tests passed');
  } catch (error) {
    console.error(logs);
    throw error;
  } finally {
    if (server) {
      server.kill('SIGTERM');
      if (server.exitCode === null) await new Promise((resolve) => server.once('close', resolve));
    }
    if (redis.isOpen) await redis.disconnect();
    await client.close();
  }
}

main().catch((error) => { console.error(error.stack); process.exitCode = 1; });
