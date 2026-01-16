const config = require('config');
const BaseHandler = require('../../BaseHandler');

class Handler extends BaseHandler {
  static eventName = 'SaleCreated';

  static eventFilter = {
    DEPRECATED_AT: config.get('Events.handlers.ethereum.ArvadCrewSale.SaleCreated.deprecatedAt')
  };

  processEvent() {
    this.eventDoc.set('ignore', true);
  }
}

module.exports = Handler;
