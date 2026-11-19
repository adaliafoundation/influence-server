const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(
  `${__dirname}/../../bin/sync_mongo_indexes.js`,
  'utf8'
);

function runSync({ shouldFail = false, disconnectFails = false, delayConnection = false } = {}) {
  return new Promise(resolve => {
    const calls = [];
    const error = new Error('Simulated index failure');

    let connect;
    const connectionReady = new Promise(done => {
      connect = done;
    });

    const model = {
      async diffIndexes() {
        calls.push('diffIndexes');
        return { toDrop: [], toCreate: [] };
      },
      async syncIndexes() {
        calls.push('syncIndexes');
        if (shouldFail) throw error;
      }
    };

    const mongoose = {
      models: { TestModel: model },
      model: () => model,
      connection: {
        async asPromise() {
          calls.push('waitForConnection');
          await connectionReady;
        }
      },
      async disconnect() {
        calls.push('disconnect');
        if (disconnectFails) throw new Error('Simulated disconnect failure');
      }
    };

    vm.runInNewContext(source, {
      require(name) {
        if (name === 'module-alias/register') return {};
        if (name === 'dotenv') return { config: () => {} };
        if (name === '@common/storage/db') return { mongoose };
        throw new Error(`Unexpected dependency: ${name}`);
      },
      console: {
        info() {},
        error(message) {
          calls.push(`error: ${message.message}`);
        }
      },
      process: {
        exit(code) {
          resolve({ code, calls });
        }
      }
    });

    if (!delayConnection) connect();

    // For the connection-readiness test, release the
    // simulated connection after the first microtask.
    if (delayConnection) {
      queueMicrotask(() => {
        calls.push('connectionReleased');
        connect();
      });
    }
  });
}

test('successful index synchronization exits with 0', async () => {
  const result = await runSync();
  assert.equal(result.code, 0);
  assert.ok(result.calls.includes('syncIndexes'));
});

test('failed index synchronization exits with 1', async () => {
  const result = await runSync({ shouldFail: true });
  assert.equal(result.code, 1);
  assert.ok(result.calls.includes('error: Simulated index failure'));
});

test('waits for MongoDB connection before synchronizing', async () => {
  const result = await runSync({ delayConnection: true });
  assert.ok(result.calls.includes('waitForConnection'));
  assert.ok(
    result.calls.indexOf('syncIndexes') >
    result.calls.indexOf('connectionReleased')
  );
});

test('disconnects after successful synchronization', async () => {
  const result = await runSync();
  assert.ok(result.calls.includes('disconnect'));
  assert.ok(
    result.calls.indexOf('disconnect') >
    result.calls.indexOf('syncIndexes')
  );
});

test('disconnects after synchronization failure', async () => {
  const result = await runSync({ shouldFail: true });
  assert.ok(result.calls.includes('disconnect'));
  assert.equal(result.code, 1);
});

test('preserves the synchronization error and logs a disconnect failure', async () => {
  const result = await runSync({ shouldFail: true, disconnectFails: true });
  assert.equal(result.code, 1);
  assert.deepEqual(result.calls, [
    'waitForConnection',
    'diffIndexes',
    'syncIndexes',
    'disconnect',
    'error: Simulated disconnect failure',
    'error: Simulated index failure'
  ]);
});

test('successful synchronization with a disconnect failure exits with 1', async () => {
  const result = await runSync({ disconnectFails: true });
  assert.equal(result.code, 1);
  assert.deepEqual(result.calls, [
    'waitForConnection',
    'diffIndexes',
    'syncIndexes',
    'disconnect',
    'error: Simulated disconnect failure'
  ]);
});
