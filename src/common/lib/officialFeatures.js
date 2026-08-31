const appConfig = require('config');

const isEnabled = (path) => Number(appConfig.get(path)) === 1;

module.exports = {
  isAvnuPaymasterEnabled: () => isEnabled('Avnu.paymasterEnabled'),
  isStarterPackProvisionerEnabled: () => isEnabled('StarterPack.provisionerEnabled')
};
