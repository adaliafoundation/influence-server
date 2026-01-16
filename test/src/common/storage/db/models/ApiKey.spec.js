const { expect } = require('chai');
const { apiKey } = require('@common/lib/hash');
const {
  ApiKeyFactory
} = require('../../../../../factories');

describe('ApiKey Schema', function () {
  const key = '15f50f1b-139f-420d-92ea-1cb45c7ad2e8';
  const keyHash = '$2a$08$fCkmy/lm2EKLfpcjzWAJueJN0kIp.LOMW2QUkdmMBIfcFFMEfgo/e';

  afterEach(function () {
    return this.utils.resetCollections(['ApiKey']);
  });

  describe('validSecret', function () {
    it('should return true if the secret is valid', async function () {
      const doc = await ApiKeyFactory.makeOne({ client_secret: apiKey.generateHash(key) });
      const isValid = doc.validSecret(key);
      expect(isValid).to.eql(true);
    });

    it('should validate secrets with older hashes (hashed with bcrypt-nodejs)', async function () {
      const doc = await ApiKeyFactory.makeOne({ client_secret: keyHash });
      const isValid = doc.validSecret(key);
      expect(isValid).to.eql(true);
    });
  });
});
