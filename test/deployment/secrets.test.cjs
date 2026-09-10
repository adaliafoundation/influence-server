const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { loadSecretFiles, SECRET_PATHS } = require('../../src/common/lib/secretFiles');

test('every supported secret file resolves to its configuration path, without mutating env', () => {
  const dir = mkdtempSync(join(tmpdir(), 'influence-secrets-'));
  try {
    const file = join(dir, 'secret');
    writeFileSync(file, '  secret-content\r\n');
    for (const [name, path] of Object.entries(SECRET_PATHS)) {
      const env = { [`${name}_FILE`]: file };
      const config = loadSecretFiles(env);
      assert.equal(path.split('.').reduce((value, key) => value[key], config), 'secret-content');
      assert.deepEqual(env, { [`${name}_FILE`]: file });
    }
  } finally { rmSync(dir, { recursive: true }); }
});

test('missing, empty and conflicting secret files fail without disclosing contents or paths', () => {
  const dir = mkdtempSync(join(tmpdir(), 'influence-secrets-'));
  try {
    const file = join(dir, 'empty');
    writeFileSync(file, '\n');
    assert.throws(() => loadSecretFiles({ JWT_SECRET_FILE: file }), /Empty secret configured by JWT_SECRET_FILE/);
    assert.throws(() => loadSecretFiles({ JWT_SECRET_FILE: '' }), /Cannot read secret configured by JWT_SECRET_FILE/);
    assert.throws(() => loadSecretFiles({ JWT_SECRET_FILE: dir }), /Cannot read secret/);
    assert.throws(() => loadSecretFiles({ JWT_SECRET_FILE: file, JWT_SECRET: 'do-not-print' }),
      /^Error: Configure only one of JWT_SECRET and JWT_SECRET_FILE$/);
    assert.deepEqual(loadSecretFiles({ UNKNOWN_FILE: '/missing', JWT_SECRET: 'existing' }), {});
  } finally { rmSync(dir, { recursive: true }); }
});

test('node-config loads files after production defaults, without exporting secrets', () => {
  const dir = mkdtempSync(join(tmpdir(), 'influence-secrets-'));
  try {
    const file = join(dir, 'secret');
    writeFileSync(file, 'file-secret\n');
    const env = { PATH: process.env.PATH, NODE_ENV: 'production', AVNU_PAYMASTER_URL_FILE: file };
    const script = "const c=require('config'); process.stdout.write(JSON.stringify([c.get('Avnu.paymasterUrl'), process.env.AVNU_PAYMASTER_URL]));";
    assert.deepEqual(JSON.parse(execFileSync(process.execPath, ['-e', script], { env, cwd: resolve(__dirname, '../..') })),
      ['file-secret', null]);
    const result = spawnSync(process.execPath, ['-e', script], {
      env: { ...env, AVNU_PAYMASTER_URL: 'plain-secret' }, encoding: 'utf8'
    });
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stderr, /file-secret|plain-secret/);
    assert.match(result.stderr, /Configure only one/);
  } finally { rmSync(dir, { recursive: true }); }
});

test('plain environment configuration and prerelease optional workers remain supported', () => {
  const result = execFileSync(process.execPath, ['-e',
    "const c=require('config'); process.stdout.write(JSON.stringify([c.get('App.jwtSecret'),c.get('Health.requiredWorkers'),c.get('App.logFormat')]));"
  ], { env: { PATH: process.env.PATH, NODE_ENV: 'prerelease', JWT_SECRET: 'plain-secret' } });
  assert.deepEqual(JSON.parse(result), ['plain-secret', [], 'text']);
});
