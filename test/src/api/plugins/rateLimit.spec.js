const { expect } = require('chai');
const Koa = require('koa');
const { ServerResponse } = require('http');
const createRateLimit = require('@api/plugins/rateLimit');

describe('API rate limit', function () {
  it('should exempt only webhook POSTs when the IP budget is exhausted', async function () {
    const limit = createRateLimit();
    const app = new Koa();
    const invoke = async (method, url, headers = {}) => {
      const req = { method, url, headers, socket: { remoteAddress: '127.0.0.1' } };
      const ctx = app.createContext(req, new ServerResponse(req));
      await limit(ctx, async () => { ctx.status = 204; });
      return ctx.status;
    };

    for (let i = 0; i < 50; i += 1) {
      expect(await invoke('GET', '/v2/constants')).to.equal(204);
    }
    expect(await invoke('GET', '/v2/constants')).to.equal(429);
    expect(await invoke('POST', '/v2/stripe/webhook')).to.equal(204);
    expect(await invoke('GET', '/v2/stripe/webhook')).to.equal(429);
    expect(await invoke('POST', '/v2/stripe/webhook/other')).to.equal(429);
    expect(await invoke('POST', '/v2/crewmate-purchases/checkout', {
      'stripe-signature': 'not-a-real-signature'
    })).to.equal(429);
  });
});
