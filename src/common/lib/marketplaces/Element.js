const appConfig = require('config');
const axios = require('axios');
const logger = require('../logger');

const refreshAsset = async ({ collection, id, logName }) => {
  if (!appConfig?.Element?.uri || !appConfig?.Element?.chain) return;

  const contractAddress = appConfig.Contracts?.starknet?.[collection];
  if (!contractAddress) {
    logger.warn(`Element::${logName}, missing Contracts.starknet.${collection}`);
    return;
  }

  const params = new URLSearchParams({
    chain: appConfig.Element.chain,
    contract_address: contractAddress,
    token_id: id
  });
  const query = `${appConfig.Element.uri}/asset/refreshMeta?${params.toString()}`;

  try {
    const response = await axios.get(query);
    logger.info(`Element::${logName}, updated ${collection} tokenID: ${id}, with status: ${response.status}`);
  } catch (error) {
    logger.error(error);
  }
};

class Element {
  static isEnabled() {
    return Boolean(appConfig?.Element?.uri && appConfig?.Element?.chain);
  }

  static async updateAsteroidAsset({ id }) {
    await refreshAsset({ collection: 'asteroid', id, logName: 'updateAsteroidAsset' });
  }

  static async updateCrewmateAsset({ id }) {
    await refreshAsset({ collection: 'crew', id, logName: 'updateCrewmateAsset' });
    await refreshAsset({ collection: 'crewmate', id, logName: 'updateCrewmateAsset' });
  }
}

module.exports = Element;
