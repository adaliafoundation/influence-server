function unpack(packed, stride) {
  const unpacked = [];

  let p = BigInt(packed);
  let i = 0;
  while (p > 0n) {
    const base = 2n ** BigInt(Array.isArray(stride) ? stride[i] : stride);
    const x = BigInt(p % base);
    p = (p - x) / base;
    i += 1;

    unpacked.push(Number(x));
  }

  return unpacked;
}

function unpackBitmap(packed) {
  return unpack(packed, 1)
    .map((u, i) => (u > 0 ? i : -1))
    .filter((u) => u >= 0);
}

module.exports = {
  unpack,
  unpackBitmap
};
