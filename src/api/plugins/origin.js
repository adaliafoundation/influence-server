const appConfig = require('config');

const ALLOWED_ORIGINS = [
  /(.*):\/\/influence-client-pr-[0-9]+.herokuapp.com\/?/i, // heroku review builds
  new RegExp(`${appConfig.get('App.clientUrl')}/?$`, 'i'),
  new RegExp(`${appConfig.get('App.bridgeClientUrl')}/?$`, 'i')
];

const allowedEnvs = ['goerli', 'staging', 'development', 'prerelease'];
if (allowedEnvs.includes(appConfig.util.getEnv('NODE_ENV'))) ALLOWED_ORIGINS.push(/(.*):\/\/localhost:[0-9]*/i);

const allowedOrigin = ({ request: { headers: { origin } } }) => (
  (ALLOWED_ORIGINS.some((pattern) => pattern.test(origin))) ? origin : appConfig.get('App.clientUrl')
);

const isWhiteList = ({ request: { headers: { origin, referer } } }) => ((ALLOWED_ORIGINS
  .some((pattern) => pattern.test(origin) || pattern.test(referer))));

module.exports = {
  ALLOWED_ORIGINS,
  allowedOrigin,
  isWhiteList
};
