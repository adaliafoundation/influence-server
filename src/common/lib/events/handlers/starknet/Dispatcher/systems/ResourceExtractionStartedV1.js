const { hash } = require('starknet');
const { decodeEvent } = require('@common/lib/prospecting');
const ResourceExtractionStarted = require('./ResourceExtractionStarted');

class Handler extends ResourceExtractionStarted {
  static eventConfig = {
    keys: [hash.getSelectorFromName('ResourceExtractionStartedV1')],
    name: 'ResourceExtractionStartedV1',
    baseName: 'ResourceExtractionStarted',
    version: 1
  };

  static transformEventData(event) { return decodeEvent('ResourceExtractionStartedV1', event); }
}
module.exports = Handler;
