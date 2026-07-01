const PrepaidAgreementAccepted = require('./PrepaidAgreementAccepted');

class Handler extends PrepaidAgreementAccepted {
  static eventConfig = {
    keys: ['0x3d1c480175f738c3c6e82109aeffb6d5e45b979dc6e454275551e6b0863d30'],
    name: 'PrepaidMerkleAgreementAccepted'
  };
}

module.exports = Handler;
