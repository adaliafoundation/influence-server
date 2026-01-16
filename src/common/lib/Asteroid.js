const mongoose = require('mongoose');
const { Asteroid } = require('@influenceth/sdk');
const Lot = require('@common/lib/Lot');

const getBasePurchasedPrice = async function () {
  const result = await mongoose.model('Constant').findOne({ name: 'ASTEROID_PURCHASE_BASE_PRICE' });
  if (!result) throw new Error('Missing ASTEROID_PURCHASE_BASE_PRICE constant');
  return result.value;
};

const getPurchasePrice = async function (asteroidId, currency = 'USD') {
  if (!asteroidId) throw new Error('Missing asteroidId');
  if (currency !== 'USD') throw new Error('Unsupported currency');

  const lotCount = Asteroid.getSurfaceArea(asteroidId);

  // get base asteroid price
  const baseAsteroidPrice = await getBasePurchasedPrice();

  // get base lot price
  const baseLotPrice = await Lot.getBasePurchasedPrice();

  const price = BigInt(baseAsteroidPrice) + (BigInt(lotCount) * BigInt(baseLotPrice));

  return (currency === 'USD') ? (Number(price) / 1e6).toFixed(2) : Number(price);
};

module.exports = {
  getBasePurchasedPrice,
  getPurchasePrice
};
