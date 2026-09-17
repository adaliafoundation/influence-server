const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(`${__dirname}/../../bin/notification-queue.js`, 'utf8');

test('queue inspection reports due, expired, and future documents without writes', async () => {
  const now = Date.now();
  const day = 86400000;
  const documents = [-31, -29, -1, 1].map(days => ({ notifyOn: new Date(now + days * day) }));
  let closed = false;
  let output;
  const matching = query => documents.filter(document => Object.entries(query.notifyOn).every(([op, date]) => {
    if (op === '$gte') return document.notifyOn >= date;
    if (op === '$lte') return document.notifyOn <= date;
    if (op === '$lt') return document.notifyOn < date;
    if (op === '$gt') return document.notifyOn > date;
    throw new Error(`Unexpected operator: ${op}`);
  }));
  let finish;
  const complete = new Promise(resolve => { finish = resolve; });
  const collection = {
    countDocuments: async query => matching(query).length,
    find: query => ({ sort: () => ({ limit: () => ({ toArray: async () => matching(query).slice(0, 1) }) }) })
  };
  vm.runInNewContext(source, {
    require(name) {
      if (name === 'config') return { get: () => 'mongodb://fixture' };
      assert.equal(name, 'mongoose');
      return { createConnection: () => ({ asPromise: async () => ({
        collection(name) { assert.equal(name, 'notifications'); return collection; },
        async close() { closed = true; finish(); }
      }) }) };
    },
    console: { log(value) { output = JSON.parse(value); }, error: assert.fail },
    process: {},
    Date
  });
  await complete;
  assert.equal(closed, true);
  assert.equal(output.eligibleDocuments, 2);
  assert.equal(output.olderThan30Days, 1);
  assert.equal(output.futureDocuments, 1);
  assert.equal(output.oldestEligibleAt, documents[1].notifyOn.toISOString());
});
