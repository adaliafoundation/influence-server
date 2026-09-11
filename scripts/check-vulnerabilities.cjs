const { readFileSync } = require('node:fs');

const SEVERITIES = new Set(['Unknown', 'Negligible', 'Low', 'Medium', 'High', 'Critical']);
const FIX_STATES = new Set(['fixed', 'not-fixed', 'wont-fix', 'unknown']);
const MAX_ACCEPTED_RISK_DAYS = 30;

// Grype versions report Debian's distro qualifier as either 13 or 13.6.
// Package versions, architecture, upstream and the advisory namespace remain exact.
function normalizePackageUrl(purl) {
  if (typeof purl !== 'string' || !purl.startsWith('pkg:deb/debian/')) return purl;
  return purl.replace(/([?&]distro=debian-\d+)\.\d+(?=&|$)/, '$1');
}

function validateExceptions(document, now) {
  if (!Array.isArray(document?.exceptions)) throw new Error('Invalid exceptions document');
  const seen = new Set();
  for (const entry of document.exceptions) {
    for (const field of ['vulnerability', 'package', 'version', 'type', 'namespace', 'purl', 'disposition',
      'rationale', 'evidence', 'owner', 'reviewedAt', 'expiresAt']) {
      if (typeof entry[field] !== 'string' || !entry[field].trim()) throw new Error(`Invalid exception field: ${field}`);
    }
    if (!['not_affected', 'accepted_risk'].includes(entry.disposition)) throw new Error('Invalid exception disposition');
    const reviewed = Date.parse(entry.reviewedAt);
    const expires = Date.parse(entry.expiresAt);
    if (!Number.isFinite(reviewed) || !Number.isFinite(expires) || reviewed > now || expires <= now
      || expires <= reviewed
      || (entry.disposition === 'accepted_risk' && expires - reviewed > MAX_ACCEPTED_RISK_DAYS * 86400000)) {
      throw new Error(`Expired or invalid exception dates: ${entry.vulnerability}`);
    }
    const key = JSON.stringify([entry.vulnerability, entry.package, entry.version, entry.type, entry.namespace, normalizePackageUrl(entry.purl)]);
    if (seen.has(key)) throw new Error(`Duplicate exception: ${entry.vulnerability}`);
    seen.add(key);
  }
  return document.exceptions;
}

function evaluate(report, document = { exceptions: [] }, now = Date.now()) {
  if (!Array.isArray(report?.matches)) throw new Error('Invalid Grype report: matches are missing');
  const exceptions = validateExceptions(document, now);
  const result = { total: report.matches.length, blocking: [], excepted: [], warnings: [] };
  for (const match of report.matches) {
    const { vulnerability: v, artifact: a } = match || {};
    if (!v || !SEVERITIES.has(v.severity) || !v.id || !v.namespace || !a?.name || !a.version || !a.type) {
      throw new Error('Invalid Grype vulnerability or artifact');
    }
    // A future or unsupported severity/fix schema must not silently downgrade the gate.
    if (!['High', 'Critical'].includes(v.severity)) continue;
    if (!v.fix || !FIX_STATES.has(v.fix.state) || !Array.isArray(v.fix.versions)) {
      throw new Error(`Invalid Grype fix information: ${v.id}`);
    }
    const finding = { vulnerability: v.id, package: a.name, version: a.version, severity: v.severity };
    const exception = exceptions.find((entry) => entry.vulnerability === v.id && entry.package === a.name
      && entry.version === a.version && entry.type === a.type && entry.namespace === v.namespace
      && normalizePackageUrl(entry.purl) === normalizePackageUrl(a.purl));
    const fixable = v.fix.state === 'fixed' || v.fix.versions.length > 0;
    const unfixedHigh = v.severity === 'High' && !fixable && ['not-fixed', 'wont-fix'].includes(v.fix.state);
    // Unknown fix status stays blocking; Critical always needs verified non-applicability.
    const permitted = exception && (exception.disposition === 'not_affected'
      || (unfixedHigh && exception.disposition === 'accepted_risk'));
    if (permitted) {
      result.excepted.push({ ...finding, disposition: exception.disposition, owner: exception.owner,
        expiresAt: exception.expiresAt });
    } else if (unfixedHigh) {
      result.warnings.push({ ...finding, fixState: v.fix.state });
    } else {
      result.blocking.push(finding);
    }
  }
  return result;
}

if (require.main === module) {
  const report = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const exceptions = JSON.parse(readFileSync(process.argv[3] || 'security/vulnerability-exceptions.json', 'utf8'));
  const result = evaluate(report, exceptions);
  console.log(JSON.stringify(result, null, 2));
  if (result.warnings.length) console.log(`::warning::${result.warnings.length} unfixed High findings require periodic review.`);
  if (result.excepted.length) console.log(`::warning::${result.excepted.length} findings have reviewed exceptions.`);
  if (result.blocking.length) {
    console.error(`::error::${result.blocking.length} high/critical findings block release.`);
    process.exitCode = 1;
  }
}

module.exports = { evaluate };
