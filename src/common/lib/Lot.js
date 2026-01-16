const mongoose = require('mongoose');

const getBasePurchasedPrice = async function () {
  const result = await mongoose.model('Constant').findOne({ name: 'ASTEROID_PURCHASE_LOT_PRICE' });
  if (!result) throw new Error('Missing ASTEROID_PURCHASE_LOT_PRICE constant');
  return result.value;
};

module.exports = {
  getBasePurchasedPrice
};
