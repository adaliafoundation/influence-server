const { EntropyService } = require('@common/services');
const StarknetBaseHandler = require('../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x214fb9d85d8f0b20eb9934a83cf18c06d6f9e9a1efbc1c4b0e33c7a364b0397'],
    name: 'EntropyGenerated'
  };

  async processEvent() {
    const { returnValues: data } = this.eventDoc;
    await EntropyService.updateOrCreate({ event: this.eventDoc, data });
  }

  static transformEventData(event) {
    return {
      entropy: event.data[0],
      round: Number(event.data[1])
    };
  }
}

module.exports = Handler;
