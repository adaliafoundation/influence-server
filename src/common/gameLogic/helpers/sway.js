/**
 * Per-wallet SWAY bookkeeping for hybrid mode. The Cairo world uses an on-chain
 * ERC20 at the Sway token contract; here we keep balances on `User.swayBalance`
 * (wei-string). This module centralizes the arithmetic so handlers don't each
 * roll their own.
 *
 * Units: `amountWei` is a BigInt in wei (18 decimals), matching the on-chain
 * convention and the `User.swayBalance` field. Order.price uses the SDK's
 * 6-decimal SWAY scale, so fill-handlers convert with the `SCALE_PRICE_TO_WEI`
 * multiplier (×1e12).
 */
const mongoose = require('mongoose');
const { Address } = require('@influenceth/sdk');
const { ComponentService } = require('@common/services');
const { ValidationError } = require('../errors');

// Order.price is in 6-decimal scale (the SDK's default SWAY unit), while
// User.swayBalance is in wei (18 decimals). Bridge with ×1e12.
const SCALE_PRICE_TO_WEI = 1000000000000n;

function toStandardAddress(addr) {
  if (!addr) return null;
  try { return Address.toStandard(addr); } catch (e) { return null; }
}

async function _getOrCreateUser(address) {
  const UserModel = mongoose.model('User');
  let user = await UserModel.findOne({ address });
  if (!user) user = await UserModel.create({ address });
  return user;
}

/**
 * Resolve a crew-entity ref ({id,label}) to its NFT owner wallet address.
 * Returns a normalized starknet address or null if unknown.
 */
async function addressOfCrew(crewRef) {
  if (!crewRef?.id) return null;
  const nft = await ComponentService.findOneByEntity('Nft', crewRef);
  const raw = nft?.owners?.starknet || nft?.owners?.ethereum;
  return toStandardAddress(raw);
}

/**
 * Debit `amountWei` from `address`. Throws `ValidationError` if the balance
 * would go negative.
 */
async function debit(address, amountWei) {
  if (!address) throw new ValidationError('Debit: missing address');
  if (amountWei <= 0n) return;
  const user = await _getOrCreateUser(address);
  const balance = BigInt(user.swayBalance || '0');
  if (balance < amountWei) {
    throw new ValidationError(`Insufficient SWAY (need ${amountWei}, have ${balance})`);
  }
  user.swayBalance = (balance - amountWei).toString();
  await user.save();
}

/** Credit `amountWei` to `address`. Creates the user row if missing. */
async function credit(address, amountWei) {
  if (!address || amountWei <= 0n) return;
  const user = await _getOrCreateUser(address);
  user.swayBalance = (BigInt(user.swayBalance || '0') + amountWei).toString();
  await user.save();
}

/**
 * Transfer `amountWei` from one wallet to another. Atomic conceptually — the
 * debit fails before the credit runs, so the payer's balance can't drop
 * below zero.
 */
async function transfer({ fromAddress, toAddress, amountWei }) {
  if (amountWei <= 0n) return;
  await debit(fromAddress, amountWei);
  await credit(toAddress, amountWei);
}

/**
 * Cost of filling `amount` units at `price` (both Number, 6-decimal scale).
 * Returns BigInt wei so handlers can pass it straight to the transfer fns.
 */
function costInWei({ price, amount }) {
  return BigInt(price || 0) * BigInt(amount || 0) * SCALE_PRICE_TO_WEI;
}

// Fees are basis points (0..10000 = 0%..100%). Matches Cairo orders.cairo:60.
const FEE_SCALE = 10000n;

/**
 * Split a fill into seller + exchange cuts. Matches Cairo's `required_payments`
 * (for LIMIT_SELL fills) and `required_withdrawals` (for LIMIT_BUY fills).
 *
 * `makerFee` and `takerFee` are integers in basis points. Returns all
 * amounts as BigInt wei.
 *
 *   - valueWei      = price × amount in wei (convert via costInWei)
 *   - makerFeeWei   = valueWei × makerFee / 10000
 *   - takerFeeWei   = valueWei × takerFee / 10000
 *   - feesWei       = makerFeeWei + takerFeeWei    (→ exchange)
 *
 * `buyerPays` (charged to the taker when filling a sell order, or escrowed
 * at create-buy-order time per leg) = `valueWei + takerFeeWei` for a sell
 * fill, or `valueWei + makerFeeWei` for a buy-order escrow.
 * `sellerReceives` (for a sell fill) = `valueWei − makerFeeWei`.
 * `sellerReceives` (for a buy fill, paid from escrow) = `valueWei − takerFeeWei`.
 */
function computeFees({ price, amount, makerFee = 0, takerFee = 0 }) {
  const valueWei = costInWei({ price, amount });
  const makerFeeWei = (valueWei * BigInt(makerFee)) / FEE_SCALE;
  const takerFeeWei = (valueWei * BigInt(takerFee)) / FEE_SCALE;
  return { valueWei, makerFeeWei, takerFeeWei, feesWei: makerFeeWei + takerFeeWei };
}

/** Escrow for a LIMIT_BUY order. Buyer locks value + makerFee worth of SWAY. */
function buyOrderEscrowWei({ price, amount, makerFee = 0 }) {
  const valueWei = costInWei({ price, amount });
  const makerFeeWei = (valueWei * BigInt(makerFee)) / FEE_SCALE;
  return valueWei + makerFeeWei;
}

/**
 * Resolve the exchange controller's wallet — the address that collects
 * maker + taker fees. Returns null if the exchange has no Control component.
 */
async function addressOfExchangeController(exchangeEntity) {
  const control = await ComponentService.findOneByEntity('Control', exchangeEntity);
  return addressOfCrew(control?.controller);
}

/**
 * Lease cost in wei. `ratePerHourMicroSway` is what the client sends for
 * PrepaidPolicy.rate — microSWAY per HOUR (scale 1e6). `seconds` is the lease
 * length (client sends this as `term` in seconds).
 *
 * Conversion: micro-SWAY / hour  →  wei / second  =  rate × 1e12 / 3600
 * so the cost for `seconds` is:   rate × 1e12 × seconds / 3600
 *
 * Divides last to avoid losing the least-significant digits to integer truncation.
 */
function leaseCostWei({ ratePerHourMicroSway, seconds }) {
  if (!ratePerHourMicroSway || !seconds) return 0n;
  return (BigInt(ratePerHourMicroSway) * SCALE_PRICE_TO_WEI * BigInt(seconds)) / 3600n;
}

module.exports = {
  addressOfCrew,
  addressOfExchangeController,
  buyOrderEscrowWei,
  computeFees,
  costInWei,
  credit,
  debit,
  leaseCostWei,
  transfer,
  FEE_SCALE,
  SCALE_PRICE_TO_WEI
};
