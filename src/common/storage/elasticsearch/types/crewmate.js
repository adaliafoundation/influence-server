module.exports = {
  properties: {
    status: { type: 'byte' },
    coll: { type: 'short' },
    class: { type: 'short' },
    title: { type: 'short' },
    appearance: { type: 'text', index: false }, // 128bit stored as hex string
    cosmetic: { type: 'short' },
    impactful: { type: 'short' }
  }
};
