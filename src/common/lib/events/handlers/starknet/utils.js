const extractInventories = function (data) {
  const len = Number(data.shift());
  const results = [];
  for (let i = 0; i < len; i += 1) {
    results.push({ product: Number(data.shift()), amount: Number(data.shift()) });
  }

  return results;
};

class Fixed {
  constructor(mag, sign, size = 64) {
    if (![64, 128].includes(size)) throw new Error('Invalid size. Must be 64 or 128');
    this.mag = mag;
    this.sign = Number(sign);
    this.size = size;
  }

  static toFixed(input, size = 64) {
    if (Array.isArray) return new Fixed(input[0], input[1], size);
    return new Fixed(input);
  }

  valueOf() {
    const _value = this.mag / (2 ** (this.size === 64 ? 32 : 64));
    return (this.sign) ? -_value : _value;
  }
}

module.exports = {
  extractInventories,
  Fixed
};
