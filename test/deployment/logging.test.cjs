const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { resolve } = require('node:path');
const { createRedactor } = require('../../src/common/lib/logRedaction');

test('redacts nested credentials, payment payloads, provider URLs and cyclic HTTP errors', () => {
  const redact = createRedactor(['configured-private-key']);
  const error = Object.assign(new Error('cardholder@example.com {card: 1234}'), {
    config: { headers: { Authorization: 'Bearer hidden' } }, response: { data: 'payment-content' }
  });
  error.cause = error;
  const input = {
    event: 'failure', error,
    nested: { authorization: 'Basic opaque', password: 'password-value', apiKey: 'api-key-value',
      privateKey: 'key-value', cookies: 'cookie-value', body: { customer: 'payment-customer' },
      payload: 'payload-content', provider: 'provider-value', payment: { details: 'details-value' } },
    text: 'configured-private-key https://rpc.example/v3/hidden wss://rpc.example/hidden mongodb://user:pass@db/test',
    auth: 'Bearer opaque-token', value: 'sk_live_other-secret', amount: 123n
  };
  input.self = input;
  const output = JSON.stringify(redact(input));
  for (const secret of ['configured-private-key', 'rpc.example', 'user:pass', 'opaque', 'password-value',
    'api-key-value', 'key-value', 'cookie-value', 'payment-customer', 'payload-content', 'provider-value',
    'details-value', 'cardholder', '1234', 'payment-content', 'sk_live_other']) assert.ok(!output.includes(secret), secret);
  assert.match(output, /failure/);
  assert.match(output, /Truncated/);
  assert.equal(input.nested.password, 'password-value');
});

test('production console, inspect, and unhandled errors emit sanitized single-line JSON', () => {
  const script = `
    console.error(new Error('private-payment-content'));
    require('./src/common/lib/logger').inspect({ payload: 'payment-content', safe: 'visible' }, 'info');
    console.log('https://provider.example/api/secret');
    Promise.reject(new Error('rejection-payment-content'));
  `;
  const result = spawnSync(process.execPath, ['--require', resolve('src/common/lib/productionBootstrap.js'),
    '--no-warnings', '-e', script], {
    env: { PATH: process.env.PATH, NODE_ENV: 'production', DOTENV_CONFIG_PATH: '/missing' }, encoding: 'utf8'
  });
  assert.equal(result.status, 1);
  const output = result.stdout + result.stderr;
  assert.doesNotMatch(output, /private-payment-content|rejection-payment-content|provider\.example|payment-content|\u001b/);
  const records = output.trim().split('\n').map(JSON.parse);
  assert.equal(records.filter((record) => record.level !== 'warn').length, 4);
  assert.ok(records.every((record) => record.timestamp && record.level));
  assert.match(output, /visible/);
  assert.match(output, /unhandled_rejection/);
});

test('serialized payloads and free-text credential assignments are also redacted', () => {
  const redact = createRedactor();
  const value = redact('failure ' + JSON.stringify({ payload: { customer: 'private-person' }, safe: 'visible' }));
  assert.doesNotMatch(value, /private-person/);
  assert.match(value, /visible/);
  assert.equal(redact('Key: generated-key'), 'Key=[REDACTED]');
  assert.equal(redact('payment={anything sensitive}'), 'payment=[REDACTED]');
});

test('request logging uses route templates and generated IDs without raw queries or headers', async () => {
  const Koa = require('koa');
  const Router = require('@koa/router');
  const request = require('supertest');
  const logger = require('../../src/common/lib/logger');
  const requestLogging = require('../../src/api/plugins/requestLogging');
  const records = [];
  const originals = { debug: logger.debug, warn: logger.warn, error: logger.error };
  for (const level of Object.keys(originals)) logger[level] = (record) => records.push(record);
  try {
    const app = new Koa();
    app.on('error', () => {});
    app.use(requestLogging);
    const router = new Router();
    router.get('/users/:id', (ctx) => { ctx.body = 'ok'; });
    router.get('/failure', (ctx) => { ctx.throw(503, 'private-payment-details'); });
    app.use(router.routes());
    const response = await request(app.callback()).get('/users/private-user?token=private-query')
      .set('Authorization', 'Bearer private-header').set('X-Request-ID', 'untrusted-id').expect(200);
    assert.equal(records[0].route, '/users/:id');
    assert.equal(records[0].requestId, response.headers['x-request-id']);
    await request(app.callback()).get('/failure').expect(503);
    assert.equal(records[1].status, 503);
    assert.doesNotMatch(JSON.stringify(records), /private-user|private-query|private-header|untrusted-id|private-payment/);
  } finally { Object.assign(logger, originals); }
});
