const { shortString } = require('starknet');
const { ConstantService } = require('@common/services');
const StarknetBaseHandler = require('../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x3f343b91a17d4c5a305f2e878bcc2c5a386fd2185d5403de50c2903a70badbc'],
    name: 'ConstantRegistered'
  };

  async processEvent() {
    const { returnValues: data } = this.eventDoc;
    await ConstantService.updateOrCreateFromEvent({ event: this.eventDoc, data });
  }

  static transformEventData(event) {
    return {
      name: shortString.decodeShortString(event.data[0]),
      value: event.data[1]
    };
  }
}

module.exports = Handler;
