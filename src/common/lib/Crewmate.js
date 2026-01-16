const mongoose = require('mongoose');

const getBasePurchasedPrice = async function () {
  const result = await mongoose.model('Constant').findOne({ name: 'ADALIAN_PURCHASE_PRICE' });
  if (!result) throw new Error('Missing ADALIAN_PURCHASE_PRICE constant');
  return result.value;
};

const getPurchasePrice = async function (crewmateId, currency = 'USD') {
  if (!crewmateId) throw new Error('Missing crewmateId');
  if (currency !== 'USD') throw new Error('Unsupported currency');

  // get base price
  const basePrice = await getBasePurchasedPrice();

  return (currency === 'USD') ? (Number(basePrice) / 1e6).toFixed(2) : Number(basePrice);
};

module.exports = {
  getBasePurchasedPrice,
  getPurchasePrice
};
