const { Address } = require('@influenceth/sdk');
const SwayClaimService = require('@common/services/SwayClaim');
const BaseHandler = require('../Handler');

class Handler extends BaseHandler {
  static eventName = 'TesterPhase1SwayClaimed';

  async processEvent() {
    const { returnValues: { account } } = this.eventDoc;
    await SwayClaimService.claim(Address.toStandard(account), 'Testnet 1');
  }
}

module.exports = Handler;
