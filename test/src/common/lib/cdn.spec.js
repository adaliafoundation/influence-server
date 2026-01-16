const { expect } = require('chai');
const appConfig = require('config');
const sinon = require('sinon');
const uuid = require('short-uuid');
const Cdn = require('@common/lib/Cdn');
const { switchNodeEnv, restoreNodeEnv } = require('../../../utils');

describe('Cdn', function () {
  let cdnInstance;
  let sandbox;

  beforeEach(function () {
    cdnInstance = new Cdn();
    sandbox = sinon.createSandbox();
  });

  afterEach(function () {
    restoreNodeEnv();
    appConfig.util.initParam('NODE_ENV');
    sandbox.restore();
  });

  describe('envKey', function () {
    it('should return \'dev\' when NODE_ENV is development or null', function () {
      switchNodeEnv('development');
      appConfig.util.initParam('NODE_ENV');
      expect(Cdn.envKey).to.eql('dev');
    });

    it('should return \'goerli\' when NODE_ENV is goerli', function () {
      switchNodeEnv('goerli');
      appConfig.util.initParam('NODE_ENV');
      expect(Cdn.envKey).to.eql('goerli');
    });

    it('should return \'rinkeby\' when NODE_ENV is rinkeby', function () {
      switchNodeEnv('rinkeby');
      appConfig.util.initParam('NODE_ENV');
      expect(Cdn.envKey).to.eql('rinkeby');
    });

    it('should return \'production\' when NODE_ENV is production or prod', function () {
      switchNodeEnv('production');
      appConfig.util.initParam('NODE_ENV');
      expect(Cdn.envKey).to.eql('production');
    });
  });

  describe('formatResult', function () {
    it('should format the result based on the key', function () {
      const key = 'foo/bar/image.png';
      const expectedUrl = `https://${cdnInstance.bucket}.${cdnInstance.baseDomain}/${key}`;
      const result = cdnInstance.formatResult({ key });
      expect(result.key).to.eql(key);
      expect(result.bucket).to.eql(cdnInstance.bucket);
      expect(result.url).to.eql(expectedUrl);
    });
  });

  describe('getAsset', function () {
    it('should return null if key not found', async function () {
      sandbox.stub(cdnInstance.s3client, 'send').callsFake(async () => ({
        $metadata: { httpStatusCode: null }
      }));
      const key = uuid.uuid();
      const result = await cdnInstance.getAsset(key);
      expect(result).to.equal(null);
    });

    it('should return null error thrown', async function () {
      sandbox.stub(cdnInstance.s3client, 'send').callsFake(async () => {
        const error = new Error('Error');
        error.$metadata = { httpStatusCode: 404 };
        throw error;
      });
      const key = uuid.uuid();
      const result = await cdnInstance.getAsset(key);
      expect(result).to.equal(null);
    });

    it('should return an object for the key if it exists in cache and exists', async function () {
      const value = { key: uuid.uuid() };
      const { key } = value;
      sandbox.stub(cdnInstance.s3client, 'send').callsFake(async () => ({
        $metadata: { httpStatusCode: 200 }
      }));

      const result = await cdnInstance.getAsset(key);

      expect(result).to.be.an('object');
      expect(result.key).to.equal(key);
    });
  });

  describe('getAssets', function () {
    it('should call send on the s3Client and return formatted results if found', async function () {
      sandbox.stub(cdnInstance.s3client, 'send').callsFake(async () => ({
        Contents: [{ Key: 'foo/1' }, { Key: 'bar/1' }]
      }));

      const assets = await cdnInstance.getAssets('/foo');
      expect(assets[0].key).to.eql('foo/1');
      expect(assets[1].key).to.eql('bar/1');
    });
  });

  describe('getUrl', function () {
    it('should return a url with the clould front url if the file type is an svg', async function () {
      const url = cdnInstance.getUrl({ fileType: 'svg', key: 'foo/1.svg' });
      expect(url).to.eql(`${cdnInstance.cloudFrontEndpoint}/foo/1.svg`);
    });

    it('should return a url with the clould front url if no resize requested', async function () {
      const url = cdnInstance.getUrl({ fileType: 'png', key: 'foo/1.png' });
      expect(url).to.eql(`${cdnInstance.cloudFrontEndpoint}/foo/1.png`);
    });

    it('should return a url with the image handler url if resize is requested', async function () {
      const url = cdnInstance.getUrl({ fileType: 'png', key: 'foo/1.png', width: 100 });
      expect(url).to.contain(cdnInstance.imageHandlerEndpoint);
    });
  });

  describe('invalidateAll', function () {
    it('should call both invalidateCloudFront and invalidateImageHandler', async function () {
      const stub1 = sandbox.stub(cdnInstance, 'invalidateCloudFront').callsFake(async () => true);
      const stub2 = sandbox.stub(cdnInstance, 'invalidateImageHandler').callsFake(async () => true);

      await cdnInstance.invalidateAll();
      expect(stub1.calledOnce).to.eql(true);
      expect(stub2.calledOnce).to.eql(true);
    });
  });

  describe('invalidateCloudFront', function () {
    it('should call send on the cloudFrontClient', async function () {
      const stub = sandbox.stub(cdnInstance.cloudFrontClient, 'send').callsFake(async () => true);
      await cdnInstance.invalidateCloudFront([]);
      expect(stub.calledOnce).to.eql(true);
    });
  });

  describe('invalidateImageHandler', function () {
    it('should call send on the cloudFrontClient', async function () {
      const stub = sandbox.stub(cdnInstance.cloudFrontClient, 'send').callsFake(async () => true);
      await cdnInstance.invalidateImageHandler([]);
      expect(stub.calledOnce).to.eql(true);
    });
  });

  describe('_remove', function () {
    it('should remove the specified item with the specified key', async function () {
      const stub = sandbox.stub(cdnInstance.s3client, 'send')
        .callsFake(async () => ({ $metadata: { httpStatusCode: 204 } }));

      const result = await cdnInstance._remove('asdf');
      expect(result).to.equal(true);
      expect(stub.calledOnce);
    });
  });

  describe('removeAll', function () {
    it('should call _remove for each specified key', async function () {
      const stub = sandbox.stub(cdnInstance, '_remove').callsFake(async () => true);
      await cdnInstance.removeAll([uuid.uuid(), uuid.uuid(), uuid.uuid()]);
      expect(stub.calledThrice).to.eql(true);
    });
  });

  describe('upload', function () {
    it('should upload the specified item with the specified path and cache the result', async function () {
      sandbox.stub(cdnInstance.s3client, 'send')
        .callsFake(async () => ({ $metadata: { httpStatusCode: 200 } }));
      const key = 'this/is/a/test/foo.png';
      try {
        const result = await cdnInstance.upload({ contentType: 'foo', data: 'test', key });
        expect(result.key).to.eql(key);
      } catch (error) {
        expect(error).to.eql(null);
      }
    });
  });
});
