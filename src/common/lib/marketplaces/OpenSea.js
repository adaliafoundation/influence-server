const appConfig = require('config');
const axios = require('axios');
const logger = require('../logger');

class OpenSea {
  static veryifyConfig() {
    if (!appConfig?.OpenSea?.uri) throw new Error('OpenSea::updateAsteroidAsset, missing OpenSea.uri');

    if (!appConfig?.OpenSea?.chain) throw new Error('OpenSea::updateAsteroidAsset, missing OpenSea.chain');
  }

  static async updateAsteroidAsset({ id }) {
    if (!appConfig.Contracts?.ethereum?.asteroid) {
      logger.warn('OpenSea::updateAsteroidAsset, missing Contracts.ethereum.asteroid');
      return;
    }

    try {
      this.veryifyConfig();
    } catch (error) {
      logger.warn(error.message);
      return;
    }

    const query = `${appConfig.OpenSea.uri}/chain/${appConfig.OpenSea.chain}`
      + `/contract/${appConfig.Contracts.ethereum.asteroid}/nfts/${id}/refresh`;
    const options = {};
    if (appConfig.OpenSea.key) options.headers = { 'x-api-key': appConfig.OpenSea.key };
    try {
      const response = await axios.post(query, {}, options);
      logger.info(`OpenSea::updateAsteroidAsset, updated asteroidID: ${id}, with status: ${response.status}`);
    } catch (error) {
      logger.error(error.message, error.request.host + error.request.path);
    }
  }

  static async updateCrewmateAsset({ id }) {
    try {
      this.veryifyConfig();
    } catch (error) {
      logger.warn(error.message);
      return;
    }

    if (appConfig.Contracts?.ethereum?.crew) {
      const query = `${appConfig.OpenSea.uri}/chain/${appConfig.OpenSea.chain}`
      + `/contract/${appConfig.Contracts.ethereum.crew}/nfts/${id}/refresh`;
      const options = {};
      if (appConfig.OpenSea.key) options.headers = { 'x-api-key': appConfig.OpenSea.key };

      try {
        const response = await axios.post(query, {}, options);
        logger.info(`OpenSea::updateCrewmateAsset, updated crewmateId: ${id}, with status: ${response.status}`);
      } catch (error) {
        logger.error(error.message, error.request.host + error.request.path);
      }
    } else {
      logger.warn('OpenSea::updateCrewmateAsset, missing Contracts.ethereum.crew');
    }

    if (appConfig.Contracts?.ethereum?.crewmate) {
      const query = `${appConfig.OpenSea.uri}/chain/${appConfig.OpenSea.chain}`
      + `/contract/${appConfig.Contracts.ethereum.crewmate}/nfts/${id}/refresh`;
      const options = {};
      if (appConfig.OpenSea.key) options.headers = { 'x-api-key': appConfig.OpenSea.key };

      try {
        const response = await axios.post(query, {}, options);
        logger.info(`OpenSea::updateCrewmateAsset, updated crewmateId: ${id}, with status: ${response.status}`);
      } catch (error) {
        logger.error(error.message, error.request.host + error.request.path);
      }
    } else {
      logger.warn('OpenSea::updateCrewmateAsset, missing Contracts.ethereum.crewmate');
    }
  }
}

module.exports = OpenSea;
