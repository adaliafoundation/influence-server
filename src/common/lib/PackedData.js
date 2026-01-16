const { chunk, isArray, isString, isNil } = require('lodash');

class PackedData {
  /**
   * @param {Object} packedData<Array<Number>>, packedWidth<Number>
   * @returns {PackedData}
   * @throws {Error}
   * @constructor
   */
  constructor({ packedData, packedWidth }) {
    if (!packedWidth) throw new Error('Invalid packedWidth');
    if (isNil(packedData) || !isArray(packedData)) throw new Error('Invalid packedData');

    this.packedData = packedData;
    this.packedWidth = packedWidth;
  }

  /**
   * Returns the value at the given index
   * @param {Number} index
   * @returns {String}
   */
  get(index) {
    const startIndex = Math.floor((index * this.packedWidth) / 32);
    const endIndex = Math.ceil((index * this.packedWidth) / 32);
    const startPos = (index * this.packedWidth) % 32;

    const segments = this.unpack(startIndex, endIndex).join('').split('');
    return segments.slice(startPos, startPos + this.packedWidth).join('');
  }

  /**
   * Sets the value at the given index.
   * @param {Number} index
   * @param {String} value
   * @returns {PackedData}
   */
  set(index, value) {
    if (!isString(value)) throw new Error('Invalid value, must be a string');
    if (value.length !== this.packedWidth) {
      throw new Error(`Invalid value length. Expected ${this.packedWidth} but got ${value.length}.`);
    }

    const startIndex = Math.floor((index * this.packedWidth) / 32);
    const endIndex = Math.ceil((index * this.packedWidth) / 32);
    const startPos = (index * this.packedWidth) % 32;

    // Unpack and join only the block(s) needed
    // 'segments' will be an array of '1' and '0' strings
    const unpacked = this.unpack(startIndex, endIndex);
    const segments = unpacked.join('').split('');

    // Apply the value to the segments
    segments.splice(startPos, this.packedWidth, ...value.split(''));

    // Chunk the string into 32 bit segments.
    // Each chunk is an array of '1' and '0' strings
    const chunks = chunk(segments.join(''), 32);
    for (let i = 0; i < chunks.length; i += 1) {
      this.packedData[startIndex + i] = parseInt(chunks[i].join(''), 2);
    }
    return this;
  }

  /**
   * Convinience method to get the packed data. *Note*: this is the raw packed data
   * @returns {Array<Number>}
  */
  toArray() {
    return this.packedData;
  }

  /**
   * Convinience method to get the packed data. *Note*: this is the raw packed data
   * @returns {Array<Number>}
  */
  valueOf() {
    return this.packedData;
  }

  /**
   * Returns the unpacked data as an array of 32 bit binary strings
   * Note: each value will be front padded with 0's for those lost when packing to an integer
   * @returns {Array<String>}
   */
  unpack(start, end) {
    if (isNil(start) || isNil(end)) return this.packedData.map((packedValue) => this._unpackValue(packedValue));
    return this.packedData.slice(start, end + 1).map((packedValue) => this._unpackValue(packedValue));
  }

  /**
   * Returns the unpacked data as a single string
   * @returns {String}
   */
  toString() {
    return this.unpack().join('');
  }

  /**
   * Unpacks a 32 bit integer into a 32 bit binary string
   * @param {Number} value
   * @returns {String}
   */
  _unpackValue(value) {
    return value.toString(2).padStart(32, 0);
  }

  /**
   * Creates a new PackedData instance from an array of numeric or binary strings values
   * @param {String} array
   * @param {Number} packedWidth
   * @returns {PackedData}
   */
  static fromString(string, packedWidth) {
    if (!packedWidth) throw new Error('Invalid packedWidth');
    const packedData = chunk(string, 32).reduce((acc, _chunk) => {
      // @note: we pad the end of the string with 0's to ensure the value is 32 bits
      const value = parseInt(_chunk.join('').padEnd(32, 0), 2);
      acc.push(value);
      return acc;
    }, []);

    return new PackedData({ packedData, packedWidth });
  }
}

module.exports = PackedData;
