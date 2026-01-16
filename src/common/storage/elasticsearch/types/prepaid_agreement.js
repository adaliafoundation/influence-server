const entity = require('./entity');

module.exports = {
  properties: {
    endTime: { type: 'date' },
    initialTerm: { type: 'integer' },
    noticePeriod: { type: 'integer' },
    noticeTime: { type: 'date' },
    permission: { type: 'integer' },
    permitted: entity,
    rate: { type: 'float' },
    startTime: { type: 'date' }
  }
};
