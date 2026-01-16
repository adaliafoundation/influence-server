module.exports = {
  properties: {
    abundances: { type: 'text' },
    bonuses: { type: 'short' },
    celestialType: { type: 'byte' },
    mass: { type: 'float' },
    purchaseOrder: { type: 'integer' },
    radius: { type: 'scaled_float', scaling_factor: 1000 },
    scanFinishTime: { type: 'date' },
    scanStatus: { type: 'byte' }
  }
};
