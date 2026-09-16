const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readCids, reconcile } = require('./migrate-ipfs-pins.cjs');

const cid = 'QmNMZt9qMRTJhiaJjkDXRa5fyXjttaj6az6BXpNNV7NkEa';
function mockFetch(list, created) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => (options.method === 'POST'
      ? created : { count: list.length, results: list }) };
  };
  return { fetchImpl, calls };
}

test('validates and deduplicates the export before requests', () => {
  assert.deepEqual(readCids(`${cid}\n${cid}`), { cids: [cid], duplicates: 1 });
  assert.throws(() => readCids('QmInvalid'), /Invalid CIDv0/);
  assert.throws(() => readCids(''), /empty/);
});

test('check mode never submits a missing CID', async () => {
  const mock = mockFetch([]);
  assert.equal((await reconcile(cid, { ...mock, token: 'test' })).status, 'missing');
  assert.equal(mock.calls.length, 1);
});

test('resuming prefers an existing pinned record over failed requests', async () => {
  const mock = mockFetch([{ status: 'failed', requestid: 'old' }, { status: 'pinned', requestid: 'good' }]);
  const result = await reconcile(cid, { ...mock, token: 'test', apply: true });
  assert.equal(result.requestid, 'good');
  assert.equal(mock.calls.length, 1);
});

test('submits a missing CID and retains its request ID', async () => {
  const mock = mockFetch([], { status: 'queued', requestid: 'new' });
  const result = await reconcile(cid, { ...mock, token: 'test', apply: true });
  assert.equal(result.requestid, 'new');
  assert.equal(mock.calls.length, 2);
  assert.equal(JSON.parse(mock.calls[1].options.body).cid, cid);
});

test('failed pins require an explicit retry', async () => {
  const mock = mockFetch([{ status: 'failed', requestid: 'old' }]);
  assert.equal((await reconcile(cid, { ...mock, token: 'test', apply: true })).status, 'failed');
  assert.equal(mock.calls.length, 1);
});

test('ambiguous POST failures are not automatically retried', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) return { ok: true, json: async () => ({ count: 0, results: [] }) };
    throw new Error('private request details');
  };
  await assert.rejects(reconcile(cid, { fetchImpl, token: 'secret', apply: true }), /rerun to reconcile/);
  assert.equal(calls, 2);
});
