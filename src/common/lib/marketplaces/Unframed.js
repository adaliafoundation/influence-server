const appConfig = require('config');
const axios = require('axios');
const logger = require('../logger');

class Unframed {
  static async updateAsteroidAsset({ id }) {
    if (!appConfig?.Unframed?.uri) {
      logger.warn('Unframed::updateAsteroidAsset, missing Unframed.uri');
      return;
    }
    if (!appConfig.Contracts?.starknet?.asteroid) {
      logger.warn('Unframed::updateAsteroidAsset, missing Contracts.starknet.asteroid');
      return;
    }

    const query = `${appConfig.Unframed.uri}/${appConfig.Contracts.starknet.asteroid}/${id}/metadataRefresh`;

    try {
      const response = await axios.post(query, {});
      logger.info(`Unframed::updateAsteroidAsset, updated asteroidID: ${id}, with status: ${response.status}`);
    } catch (error) {
      logger.error(error.message, error.request.host + error.request.path);
    }
  }

  static async updateCrewmateAsset({ id }) {
    if (!appConfig?.Unframed?.uri) {
      logger.warn('Unframed::updateCrewmateAsset, missing Unframed.uri');
      return;
    }
    if (!appConfig.Contracts?.starknet?.crewmate) {
      logger.warn('Unframed::updateCrewmateAsset, missing Contracts.starknet.crewmate');
      return;
    }

    const query = `${appConfig.Unframed.uri}/${appConfig.Contracts.starknet.crewmate}/${id}/metadataRefresh`;

    try {
      const response = await axios.get(query, {});
      logger.info(`Unframed::updateCrewmateAsset, updated crewId: ${id}, with status: ${response.status}`);
    } catch (error) {
      logger.error(error.message, error.request.host + error.request.path);
    }
  }
}

module.exports = Unframed;
