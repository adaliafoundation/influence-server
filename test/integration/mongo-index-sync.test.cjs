const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');

// Every child verifies configuration before importing the application DB module,
// then guards Mongoose's connection entry points before any connection is opened.
const childGuard = `
  const assert = require('node:assert/strict');
  require('module-alias/register');
  require('dotenv').config({ silent: true });
  const config = require('config');
  const expected = process.env.INDEX_SYNC_TEST_URI;
  const database = process.env.INDEX_SYNC_TEST_DATABASE;
  const target = new URL(expected);
  assert.equal(target.protocol, 'mongodb:');
  assert.equal(target.hostname, '127.0.0.1');
  assert.ok(target.port);
  assert.equal(target.pathname, '/' + database);
  assert.match(database, /^index_sync_[a-f0-9]{32}$/);
  assert.equal(config.get('MongoDb.uri'), expected, 'Refusing unexpected MongoDB configuration');
  assert.equal(config.get('MongoDb.autoIndex'), false);

  const mongoose = require('mongoose');
  for (const method of ['connect', 'createConnection']) {
    const original = mongoose[method];
    mongoose[method] = function (uri, options) {
      assert.equal(uri, expected, 'Refusing connection outside disposable MongoDB');
      assert.ok(!options || options.dbName === undefined || options.dbName === database,
        'Refusing database override');
      assert.equal(mongoose.get('autoIndex'), false, 'autoIndex must be disabled before connecting');
      return original.apply(this, arguments);
    };
  }
`;

function runChild(env, body, label, signal, children) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = execFile(process.execPath, ['-e', childGuard + body], {
      cwd: root,
      env,
      timeout: 60000,
      killSignal: 'SIGKILL',
      maxBuffer: 4 * 1024 * 1024
    }, (error, stdout, stderr) => {
      if (error || signal.aborted) {
        reject(new Error(`${label} failed: ${error?.message || signal.reason}\nstdout:\n${stdout}\nstderr:\n${stderr}`));
      } else {
        resolve({ stdout, stderr });
      }
    });
    const terminate = () => child.kill('SIGKILL');
    const closed = new Promise(done => {
      child.once('close', () => {
        signal.removeEventListener('abort', terminate);
        children.delete(child);
        done();
      });
    });
    children.set(child, closed);
    signal.addEventListener('abort', terminate, { once: true });
    if (signal.aborted) terminate();
  });
}

test('real index sync creates indexes with autoIndex disabled and succeeds twice', {
  timeout: 240000
}, async t => {
  // Require these inside the test so missing dependencies are reported as a failure.
  const { MongoMemoryServer } = require('mongodb-memory-server');
  const { MongoClient } = require('mongoose').mongo;
  const database = `index_sync_${randomUUID().replace(/-/g, '')}`;
  const server = new MongoMemoryServer({
    binary: { version: process.env.MONGOMS_VERSION || '7.0.14' },
    instance: { ip: '127.0.0.1', dbName: database, launchTimeout: 30000 }
  });
  let client;
  let work;
  const cancellation = new AbortController();
  const { signal } = cancellation;
  const children = new Map();
  const cancel = () => cancellation.abort(t.signal.reason);
  t.signal.addEventListener('abort', cancel, { once: true });
  if (t.signal.aborted) cancel();
  t.after(async () => {
    cancellation.abort(new Error('Integration test cleanup'));
    t.signal.removeEventListener('abort', cancel);
    try {
      // node:test cancellation does not stop an async body. Wait for it to
      // settle, including any pending startup, before closing its resources.
      // The abort listener kills children immediately while we wait.
      await Promise.allSettled([work]);
      await Promise.all([...children.values()]);
      if (client) await client.close();
    } finally {
      await server.stop({ doCleanup: true, force: true });
    }
  });
  work = (async () => {
    signal.throwIfAborted();
    await server.start();
    // A timeout during startup must not allow a late server to escape cleanup
    // or let the body continue to open connections and launch children.
    signal.throwIfAborted();
    const uri = server.getUri(database);
    const target = new URL(uri);
    assert.equal(target.protocol, 'mongodb:');
    assert.equal(target.hostname, '127.0.0.1');
    assert.equal(Number(target.port), server.instanceInfo.port);
    assert.equal(target.pathname, `/${database}`);

    // Do not inherit NODE_OPTIONS, config overrides, service URLs, or secret paths.
    const env = {
      NODE_ENV: 'test',
      NODE_CONFIG_DIR: path.join(root, 'config'),
      NODE_CONFIG: JSON.stringify({ MongoDb: { uri, autoIndex: false } }),
      MONGO_URL: uri,
      MONGO_DEBUG: '0',
      INDEX_SYNC_TEST_URI: uri,
      INDEX_SYNC_TEST_DATABASE: database
    };
    for (const key of ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot']) {
      if (process.env[key] !== undefined) env[key] = process.env[key];
    }

    await runChild(env, `
      (async () => {
        try {
          require('./src/common/storage/db');
          await mongoose.connection.asPromise();
          assert.equal(mongoose.connection.name, database);
          assert.equal(mongoose.get('autoIndex'), false);
          await Promise.all(Object.values(mongoose.models).map(model => model.init()));
          const model = mongoose.model('ApiKey');
          await model.createCollection();
          const indexes = await model.collection.listIndexes().toArray();
          assert.deepEqual(indexes.map(index => index.name), ['_id_']);
        } finally {
          await mongoose.disconnect();
        }
      })().catch(error => { console.error(error); process.exitCode = 1; });
    `, 'Initial collection and autoIndex verification', signal, children);

    signal.throwIfAborted();
    client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
      socketTimeoutMS: 10000
    });
    await client.connect();
    const db = client.db(database);
    assert.equal(db.databaseName, database);
    const collection = db.collection('apikeys');
    assert.deepEqual((await collection.listIndexes().toArray()).map(index => index.name), ['_id_']);

    const sync = "require('./bin/sync_mongo_indexes.js');";
    await runChild(env, sync, 'First synchronization', signal, children);
    const first = await collection.listIndexes().toArray();
    const created = first.find(index => index.name === 'client_id_1');
    assert.ok(created, 'First synchronization did not create the ApiKey client_id index');
    assert.deepEqual(created.key, { client_id: 1 });
    assert.equal(first.length, 2, 'Expected only _id_ and client_id_1 indexes');

    await runChild(env, sync, 'Second synchronization', signal, children);
    const second = await collection.listIndexes().toArray();
    const sorted = indexes => indexes.sort((a, b) => a.name.localeCompare(b.name));
    assert.deepEqual(sorted(second), sorted(first), 'Second synchronization changed index definitions');
  })();
  await work;
});
