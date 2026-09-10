const { test } = require('node:test');
const assert = require('node:assert/strict');
const { evaluate } = require('../../scripts/check-vulnerabilities.cjs');

const now = Date.parse('2026-09-09T12:00:00Z');
const finding = (severity = 'High', state = 'not-fixed', versions = []) => ({
  vulnerability: { id: 'CVE-example', namespace: 'debian:13', severity, fix: { state, versions } },
  artifact: { name: 'example', version: '1.0', type: 'deb', purl: 'pkg:deb/debian/example@1.0?arch=amd64' }
});
const exception = (overrides = {}) => ({
  vulnerability: 'CVE-example', namespace: 'debian:13', package: 'example', version: '1.0', type: 'deb',
  purl: 'pkg:deb/debian/example@1.0?arch=amd64', disposition: 'not_affected', owner: 'security-reviewer', rationale: 'Reviewed temporary exposure',
  evidence: 'security/review.md', reviewedAt: '2026-09-09T00:00:00Z', expiresAt: '2026-09-16T00:00:00Z',
  ...overrides
});
const check = (match, entries = []) => evaluate({ matches: [match] }, { exceptions: entries }, now);

test('Critical, fixable High and unknown-status High block; known unfixed High warns', () => {
  for (const severity of ['High', 'Critical']) {
    for (const state of ['fixed', 'not-fixed', 'wont-fix', 'unknown']) {
      const result = check(finding(severity, state));
      const warns = severity === 'High' && ['not-fixed', 'wont-fix'].includes(state);
      assert.equal(result.blocking.length, warns ? 0 : 1);
      assert.equal(result.warnings.length, warns ? 1 : 0);
    }
  }
  assert.equal(check(finding('High', 'not-fixed', ['2.0'])).blocking.length, 1);
  assert.equal(check(finding('Medium')).warnings.length, 0);
  assert.deepEqual(evaluate({ matches: [] }), { total: 0, blocking: [], excepted: [], warnings: [] });
});

test('risk acceptance never permits Critical, fixable High or unknown-status High', () => {
  for (const match of [finding('Critical'), finding('High', 'fixed'),
    finding('High', 'not-fixed', ['2.0']), finding('High', 'unknown')]) {
    assert.equal(check(match, [exception({ disposition: 'accepted_risk' })]).blocking.length, 1);
  }
});

test('reviewed non-applicability permits Critical and fixable High', () => {
  for (const severity of ['High', 'Critical']) {
    assert.equal(check(finding(severity, 'fixed', ['2.0']), [exception({ disposition: 'not_affected' })]).excepted.length, 1);
  }
});

test('exceptions match the exact vulnerability, package, version, ecosystem and namespace', () => {
  for (const field of ['vulnerability', 'package', 'version', 'type', 'namespace', 'purl']) {
    assert.equal(check(finding('Critical'), [exception({ [field]: 'different' })]).blocking.length, 1);
  }
});

test('exceptions require evidence, ownership and valid dates', () => {
  for (const field of ['rationale', 'evidence', 'owner']) {
    assert.throws(() => check(finding(), [exception({ [field]: '' })]), /Invalid exception/);
  }
  for (const dates of [
    { expiresAt: '2026-09-09T12:00:00Z' }, { reviewedAt: '2026-09-10T00:00:00Z' },
    { expiresAt: 'invalid' }
  ]) assert.throws(() => check(finding(), [exception(dates)]), /exception dates/);
  assert.throws(() => check(finding(), [exception(), exception()]), /Duplicate/);
});

test('missing or malformed report, fix information or exception policy fails closed', () => {
  for (const report of [{}, { matches: [{}] }, { matches: [finding('NewSeverity')] }]) {
    assert.throws(() => evaluate(report), /Invalid Grype/);
  }
  const match = finding();
  delete match.vulnerability.fix;
  assert.throws(() => check(match), /Invalid Grype fix/);
  assert.throws(() => evaluate({ matches: [] }, {}), /Invalid exceptions/);
});

test('architecture changes and absent package URLs cannot reuse a reviewed exception', () => {
  const match = finding('Critical');
  match.artifact.purl = 'pkg:deb/debian/example@1.0?arch=armhf';
  assert.equal(check(match, [exception()]).blocking.length, 1);
  delete match.artifact.purl;
  assert.equal(check(match, [exception()]).blocking.length, 1);
});


test('only accepted risk is limited to 30 days', () => {
  const longReview = exception({ expiresAt: '2027-01-01T00:00:00Z' });
  assert.equal(check(finding('Critical'), [longReview]).excepted.length, 1);
  assert.throws(() => check(finding(), [{ ...longReview, disposition: 'accepted_risk' }]), /exception dates/);
  assert.equal(check(finding(), [exception({ disposition: 'accepted_risk', expiresAt: '2026-10-09T00:00:00Z' })]).excepted.length, 1);
});

test('recorded not-affected decisions cover December 31 and expire on January 1 UTC', () => {
  const policy = require('../../security/vulnerability-exceptions.json');
  assert.equal(policy.exceptions.length, 7);
  for (const entry of policy.exceptions) {
    assert.equal(entry.disposition, 'not_affected');
    assert.equal(entry.expiresAt, '2027-01-01T00:00:00Z');
  }
  assert.doesNotThrow(() => evaluate({ matches: [] }, policy, Date.parse('2026-12-31T23:59:59.999Z')));
  assert.throws(() => evaluate({ matches: [] }, policy, Date.parse('2027-01-01T00:00:00Z')), /exception dates/);
});
