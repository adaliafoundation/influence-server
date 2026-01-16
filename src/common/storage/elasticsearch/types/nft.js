module.exports = {
  properties: {
    bridge: {
      properties: {
        destination: { type: 'keyword' },
        origin: { type: 'keyword' },
        status: { type: 'keyword' }
      }
    },
    chain: { type: 'keyword' },
    owner: { type: 'keyword' },
    owners: {
      properties: {
        ethereum: { type: 'keyword' },
        starknet: { type: 'keyword' }
      }
    },
    price: { type: 'double' }
  }
};
