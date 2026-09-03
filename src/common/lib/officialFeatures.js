const appConfig = require('config');

const isEnabled = (path) => Number(appConfig.get(path)) === 1;

module.exports = {
  isAvnuPaymasterEnabled: () => isEnabled('Avnu.paymasterEnabled'),
  isBanxaCheckoutEnabled: () => isEnabled('Banxa.checkoutEnabled'),
  isCrewmateProvisionerEnabled: () => isEnabled('Crewmate.provisionerEnabled'),
  isStarterPackProvisionerEnabled: () => isEnabled('StarterPack.provisionerEnabled')
};
