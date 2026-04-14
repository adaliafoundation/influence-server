const appConfig = require('config');

const MODES = { CHAIN: 'chain', HYBRID: 'hybrid' };

const mode = appConfig.get('GameMode.mode');
if (!Object.values(MODES).includes(mode)) {
  throw new Error(`Invalid GameMode.mode: "${mode}". Expected one of: ${Object.values(MODES).join(', ')}`);
}

const getMode = () => mode;
const isHybrid = () => mode === MODES.HYBRID;
const isChain = () => mode === MODES.CHAIN;
const getSyncContracts = () => appConfig.get('GameMode.chainSyncContracts');

module.exports = { MODES, getMode, isHybrid, isChain, getSyncContracts };
