module.exports = {
  properties: {
    status: { type: 'byte' },
    resource: { type: 'unsigned_long' },
    initialYield: { type: 'unsigned_long' },
    remainingYield: { type: 'unsigned_long' },
    finishTime: { type: 'date' },
    yieldEff: { type: 'double' }
  }
};
