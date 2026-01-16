const { AsteroidSaleService } = require('@common/services');
const BaseHandler = require('../../Handler');

class Handler extends BaseHandler {
  static eventConfig = {
    keys: [
      '0x297be67eb977068ccd2304c6440368d4a6114929aeb860c98b6a7e91f96e2ef',
      '0x41737465726f696453616c65'
    ],
    name: 'ComponentUpdated_AsteroidSale'
  };

  processEvent() {
    const { returnValues: data } = this.eventDoc;
    return AsteroidSaleService.updateOrCreateFromEvent({ event: this.eventDoc, data });
  }

  static transformEventData(event) {
    const data = event.data.slice(1);
    return {
      period: Number(data.shift()),
      volume: Number(data.shift())
    };
  }
}

module.exports = Handler;
