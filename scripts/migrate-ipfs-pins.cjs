#!/usr/bin/env node
const fs = require('node:fs');
const { parseArgs } = require('node:util');
const { setTimeout: sleep } = require('node:timers/promises');

const API = 'https://api.filebase.io/v1/ipfs/pins';
const ACTIVE = new Set(['pinned', 'pinning', 'queued']);

// This migration accepts the CIDv0 (dag-pb / sha2-256) format in the export.
function readCids(text) {
  const entries = text.trim().split(/\s+/).filter(Boolean);
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  for (const cid of entries) {
    if (!/^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(cid)) throw new Error(`Invalid CIDv0: ${cid}`);
    const value = [...cid].reduce((n, char) => n * 58n + BigInt(alphabet.indexOf(char)), 0n);
    if (!/^1220[0-9a-f]{64}$/.test(value.toString(16))) throw new Error(`Invalid CIDv0: ${cid}`);
  }
  if (!entries.length) throw new Error('The CID file is empty');
  return { cids: [...new Set(entries)], duplicates: entries.length - new Set(entries).size };
}

async function reconcile(cid, { token, apply, retryFailed, fetchImpl = fetch }) {
  async function request(url, body) {
    let response;
    try {
      response = await fetchImpl(url, {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(30000)
      });
    } catch {
      // A timed-out POST may have succeeded. Reconcile on the next run, never blindly retry it.
      throw new Error('Request failed or timed out; rerun to reconcile provider state');
    }
    if (!response.ok) {
      const error = new Error(`Filebase HTTP ${response.status}`);
      error.fatal = [401, 403, 429].includes(response.status);
      throw error;
    }
    return response.json();
  }

  // Query each CID directly, avoiding pagination through unrelated bucket objects.
  const query = new URLSearchParams({ cid, limit: '1000', status: 'queued,pinning,pinned,failed' });
  const listing = await request(`${API}?${query}`);
  if (!Array.isArray(listing.results) || !Number.isInteger(listing.count)) {
    throw new Error('Invalid Filebase pin listing');
  }
  if (listing.count > listing.results.length) throw new Error('Too many pin records for this CID');
  const priority = { pinned: 0, pinning: 1, queued: 2, failed: 3 };
  const records = listing.results.sort((a, b) => priority[a.status] - priority[b.status]);
  let record = records[0];
  let submitted = false;
  if (apply && (!record || (record.status === 'failed' && retryFailed))) {
    record = await request(API, { cid, name: `influence-${cid}` });
    submitted = true;
  }
  if (!record) return { cid, status: 'missing' };
  if (!(record.status in priority) || !record.requestid) throw new Error('Invalid Filebase pin response');
  return { cid, status: record.status, requestid: record.requestid, submitted };
}

async function main() {
  const { values } = parseArgs({ options: {
    input: { type: 'string' },
    report: { type: 'string' },
    check: { type: 'boolean', default: false },
    apply: { type: 'boolean', default: false },
    'retry-failed': { type: 'boolean', default: false },
    'wait-seconds': { type: 'string', default: '600' }
  } });
  if (!values.input) throw new Error('Required: --input <CID-file> [--check | --apply] --report <report.json>');
  if (values.check && values.apply) throw new Error('Choose --check or --apply');
  if (values['retry-failed'] && !values.apply) throw new Error('--retry-failed requires --apply');
  const waitSeconds = Number(values['wait-seconds']);
  if (!Number.isFinite(waitSeconds) || waitSeconds < 0) throw new Error('Invalid --wait-seconds');
  const { cids, duplicates } = readCids(fs.readFileSync(values.input, 'utf8'));
  console.log(`${cids.length} valid unique CIDv0s; ${duplicates} duplicates removed.`);
  if (!values.check && !values.apply) {
    console.log('Validation only. Use --check to inspect Filebase or --apply to submit missing pins.');
    return;
  }
  if (!process.env.FILEBASE_TOKEN) throw new Error('Set FILEBASE_TOKEN to the target bucket token');
  if (!values.report) throw new Error('--report is required for network operations');
  const path = require('node:path');
  if (path.resolve(values.input) === path.resolve(values.report)) throw new Error('Report must differ from input');
  const report = { input: path.resolve(values.input), mode: values.apply ? 'apply' : 'check', records: [] };
  const records = new Map();
  function save() {
    report.updatedAt = new Date().toISOString();
    report.records = [...records.values()];
    report.counts = report.records.reduce((counts, row) => {
      counts[row.status] = (counts[row.status] || 0) + 1;
      return counts;
    }, {});
    fs.writeFileSync(`${values.report}.tmp`, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(`${values.report}.tmp`, values.report);
  }
  save(); // Check report writability before making provider changes.
  async function inspect(cid, apply) {
    try {
      records.set(cid, { ...await reconcile(cid, {
        token: process.env.FILEBASE_TOKEN, apply, retryFailed: values['retry-failed']
      }), checkedAt: new Date().toISOString() });
    } catch (error) {
      records.set(cid, { cid, status: 'error', error: error.message });
      save();
      if (error.fatal) throw error;
    }
    save();
    await sleep(100);
  }
  // One request at a time keeps pressure low and checkpoints every CID.
  for (const [index, cid] of cids.entries()) {
    await inspect(cid, values.apply);
    if ((index + 1) % 25 === 0) console.log(`${index + 1}/${cids.length}: ${JSON.stringify(report.counts)}`);
  }
  const deadline = Date.now() + waitSeconds * 1000;
  while (values.apply && Date.now() < deadline) {
    const pending = [...records.values()].filter(row => ACTIVE.has(row.status) && row.status !== 'pinned');
    if (!pending.length) break;
    await sleep(Math.min(15000, Math.max(0, deadline - Date.now())));
    for (const row of pending) {
      if (Date.now() >= deadline) break;
      await inspect(row.cid, false);
    }
    console.log(JSON.stringify(report.counts));
  }
  console.log(`Report: ${values.report}\n${JSON.stringify(report.counts)}`);
  if (report.counts.pinned !== cids.length) process.exitCode = 2;
}

module.exports = { readCids, reconcile };
if (require.main === module) main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
