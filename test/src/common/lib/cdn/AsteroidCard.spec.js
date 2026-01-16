const { expect } = require('chai');
const sinon = require('sinon');
const appConfig = require('config');
const AsteroidCard = require('@common/lib/cdn/AsteroidCard');
const { switchNodeEnv, restoreNodeEnv } = require('../../../../utils');

describe('AsteroidCard', function () {
  let cdnInstance;

  beforeEach(function () {
    switchNodeEnv('development');
    appConfig.util.initParam('NODE_ENV');
    cdnInstance = new AsteroidCard();
  });

  afterEach(function () {
    restoreNodeEnv();
    appConfig.util.initParam('NODE_ENV');
  });

  describe('getKey', function () {
    it('should return a properly formatted key for the specified doc', function () {
      let key;
      key = cdnInstance.getKey({ doc: { id: 100 }, fileType: 'png' });
      expect(key).to.eql('influence/dev/images/asteroids/100/100.png');

      key = cdnInstance.getKey({ doc: { id: 100 }, fileType: 'svg' });
      expect(key).to.eql('influence/dev/images/asteroids/100/100.svg');
    });
  });

  describe('getKeyPrefix', function () {
    it('should return the doc\'s key prefix', async function () {
      const prefix = cdnInstance.getKeyPrefix({ id: 100 });
      expect(prefix).to.eql('influence/dev/images/asteroids/100');
    });
  });

  describe('getInvalidationPaths', function () {
    it('should return an array of paths the be invalidated', async function () {
      const prefix = 'influence/dev/images/asteroids/1';
      const encoded = 'eyJidWNrZXQiOiJ1bnN0b3BwYWJsZWdhbWVzIiwia2V5IjoiaW5mbHVlbmNlL2Rldi9pbWFnZXMvYXN0ZXJvaWRzLzE';
      const paths = cdnInstance.getInvalidationPaths({ id: 1 });
      expect(paths.length).to.eql(2);
      expect(paths[0]).to.eql(`/${prefix}*`);
      expect(paths[1]).to.eql(`/${encoded}*`);
    });
  });

  describe('purge', function () {
    it('should call removeAll and invalidateAll', async function () {
      const stub1 = sinon.stub(cdnInstance, 'removeAll').callsFake(async () => true);
      const stub2 = sinon.stub(cdnInstance, 'invalidateAll').callsFake(async () => true);

      await cdnInstance.purge({ id: 1 });

      expect(stub1.calledOnce).to.eql(true);
      expect(stub2.calledOnce).to.eql(true);
    });
  });
});
