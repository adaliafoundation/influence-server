const { expect } = require('chai');
const corsOrJwt = require('@api/plugins/corsOrJwt');

describe('corsOrJwt', function () {
  it('should set the return status to 401 if the user is missing and the api key is invalid', async function () {
    const next = async function () {
      return true;
    };
    const ctx = {
      query: { 'api-key': 'foo' },
      request: { headers: { } },
      state: { }
    };
    await corsOrJwt(ctx, next);
    expect(ctx.status).to.equal(401);
  });
});
