const appConfig = require('config');
const { expect } = require('chai');
const { allowedOrigin, isWhiteList } = require('@api/plugins/origin');

describe('origin', function () {
  describe('allowedOrigin', function () {
    it('should return the origin that matches the a value from the ALLOWED ORIGINS', function () {
      const result = allowedOrigin({ request: { headers: { origin: appConfig.get('App.clientUrl') } } });
      expect(result).to.equal(appConfig.get('App.clientUrl'));
    });

    it('should match for the bridge client url', function () {
      const result = allowedOrigin({ request: { headers: { origin: appConfig.get('App.bridgeClientUrl') } } });
      expect(result).to.equal(appConfig.get('App.bridgeClientUrl'));
    });

    it('should match for heroku build urls', function () {
      const TEST_ORIGIN = 'https://influence-client-pr-25.herokuapp.com';
      const result = allowedOrigin({ request: { headers: { origin: TEST_ORIGIN } } });
      expect(result).to.equal(TEST_ORIGIN);
    });

    it('should return the fallback CLIENT_URL if header origin does match one of the ALLOWED ORIGINS', function () {
      const result = allowedOrigin({ request: { headers: { origin: 'http://www.foo.bar' } } });
      expect(result).to.equal(appConfig.get('App.clientUrl'));
    });
  });

  describe('isWhiteList', function () {
    it('should return true if the specified origin matches an ALLOWED ORIGIN', function () {
      let result = isWhiteList({ request: { headers: { origin: appConfig.get('App.clientUrl') } } });
      expect(result).to.equal(true);

      result = isWhiteList({ request: { headers: { origin: `${appConfig.get('App.clientUrl')}/` } } });
      expect(result).to.equal(true);
    });

    it('should return true for the bridge client url', function () {
      let result = isWhiteList({ request: { headers: { origin: appConfig.get('App.bridgeClientUrl') } } });
      expect(result).to.equal(true);

      result = isWhiteList({ request: { headers: { origin: `${appConfig.get('App.bridgeClientUrl')}/` } } });
      expect(result).to.equal(true);
    });

    it('should return true for heroku pr builds', function () {
      let result = isWhiteList({ request: { headers: { origin: 'https://influence-client-pr-20.herokuapp.com' } } });
      expect(result).to.equal(true);

      result = isWhiteList({ request: { headers: { origin: 'https://influence-client-pr-20.herokuapp.com/' } } });
      expect(result).to.equal(true);
    });

    it('should return false if the specified origin does not mnatch an ALLOWED ORIGIN', function () {
      const result = isWhiteList({ request: { headers: { origin: 'http://www.foo.bar' } } });
      expect(result).to.equal(false);
    });
  });
});
