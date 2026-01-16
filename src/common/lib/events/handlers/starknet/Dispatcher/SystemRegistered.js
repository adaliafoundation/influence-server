const StarknetBaseHandler = require('../Handler');

class Handler extends StarknetBaseHandler {
  static ignore = true;

  static eventConfig = {
    keys: ['0x3437dd1689ae22432c8ea2f84eb272715fdc387f4f64c56a57c6428a97b3e90'],
    name: 'SystemRegistered'
  };

  processEvent() {
    // This handler is a placeholder and does not do any specific processing
    return null;
  }

  static transformEventData() {
    return { };
  }
}

module.exports = Handler;
