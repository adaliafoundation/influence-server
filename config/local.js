const { loadSecretFiles } = require('../src/common/lib/secretFiles');

// node-config loads this after environment-specific defaults for every Node entry point.
// Secret contents stay in configuration, never copied into process.env.
module.exports = loadSecretFiles();
