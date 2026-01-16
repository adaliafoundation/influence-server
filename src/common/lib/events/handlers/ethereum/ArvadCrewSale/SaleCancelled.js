const config = require('config');
const BaseHandler = require('../../BaseHandler');

class Handler extends BaseHandler {
  static eventName = 'SaleCancelled';

  static eventFilter = {
    DEPRECATED_AT: config.get('Events.handlers.ethereum.ArvadCrewSale.SaleCancelled.deprecatedAt')
  };

  processEvent() {
    this.eventDoc.set('ignore', true);
  }
}

module.exports = Handler;
