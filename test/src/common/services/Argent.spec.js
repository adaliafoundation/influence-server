const { expect } = require('chai');
const axios = require('axios');
const appConfig = require('config');
const { ArgentService } = require('@common/services');

describe('ArgentService', function () {
  describe('deployAccount', function () {
    it('should return the result from the relayerPath', async function () {
      const stub = this._sandbox.stub(axios, 'post').resolves({ transactionHash: '0x1234567890abcdef' });

      const result = await ArgentService.deployAccount({
        calldata: ['0x12345678'],
        class_hash: '0x0123456789',
        salt: '0x1'
      });

      const expectedUrl = 'http://null.localhost/v1/relayer/execute';

      const expectedBody = {
        calls: [{
          contractAddress: '0x041a78e741e5af2fec34b695679bc6891742439f7afb8484ecd7766661ad02bf',
          entrypoint: '0x1987cbd17808b9a23693d4de7e246a443cfe37e6e7fbaeabd7d7e6532b07c3d',
          calldata: ['0x0123456789', '0x1', '0x0', '0x1', '0x12345678']
        }]
      };

      const expectedOptions = { headers: { 'X-Argent-Api-Key': appConfig.get('Argent.apiKey') }, responseType: 'json' };

      expect(stub.calledOnce).to.equal(true);
      expect(stub.calledWith(expectedUrl, expectedBody, expectedOptions)).to.eql(true);
      expect(result).to.deep.equal({ transactionHash: '0x1234567890abcdef' });
    });

    it('should throw an error if any of the parameters are missing', async function () {
      let error;
      try {
        await ArgentService.deployAccount({});
      } catch (e) {
        error = e;
      }

      expect(error).to.be.an('error');

      try {
        await ArgentService.deployAccount({ class_hash: '0x1' });
      } catch (e) {
        error = e;
      }

      expect(error).to.be.an('error');

      try {
        await ArgentService.deployAccount({ calldata: [1] });
      } catch (e) {
        error = e;
      }

      expect(error).to.be.an('error');

      try {
        await ArgentService.deployAccount({ salt: '0x1' });
      } catch (e) {
        error = e;
      }

      expect(error).to.be.an('error');
    });
  });
});
