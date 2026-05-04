const { expect } = require('chai');
const constants = require('@common/lib/starknet/models/constants');

describe('Starknet constants', function () {
  it('should equal the max safe integer', function () {
    expect(constants.PRE_CONFIRMED_BLOCK_NUMBER).to.equal(Number.MAX_SAFE_INTEGER);
  });
});
