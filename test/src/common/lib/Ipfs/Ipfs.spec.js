const { expect } = require('chai');
const Ipfs = require('@common/lib/Ipfs/Ipfs');

const CHUNK_SIZE = 262144;
const expectHash = async function (data, expectedHash) {
  expect(await Ipfs.hashData(data)).to.equal(expectedHash);
};

describe('Ipfs', function () {
  describe('hashData', function () {
    it('should preserve the CID generated for empty data', function () {
      return expectHash('', 'QmbFMke1KXqnYyBBWxB74N4c5SBnJMVAiMNRcGu6x1AwQH');
    });

    it('should preserve the CID generated for string data', function () {
      return expectHash('hello influence', 'QmZF6bVfWMAJr76fqyCbkh9bSTrYss6TuRSArDBPqcjLbR');
    });

    it('should preserve the CID generated for Unicode data', function () {
      return expectHash('Influence 🚀 こんにちは', 'QmeFTzurtvVcdPJwoJo4EeziegCf6dUf8EREscsydmvSdH');
    });

    it('should preserve the CID generated for JSON data', function () {
      return expectHash({ hello: 'influence' }, 'QmS57UE1NWHdFUPLGBH6fmtMtybX9ZBr139qVjU9gUPhw3');
    });

    it('should preserve the CID generated for message-shaped JSON data', function () {
      return expectHash(
        { type: 'DirectMessage', sender: '0x123', encryptedMessage: 'ciphertext', version: 1 },
        'QmePUthpeD1dR4mbGjw33TGGQv3mJmcJPFGMZptMi2vbXx'
      );
    });

    it('should preserve the CID generated for annotation-shaped JSON data', function () {
      return expectHash(
        { transactionHash: '0xabc', logIndex: 7, annotation: 'Supply delivered' },
        'QmWGqvia1RJTWrPQ2XLCJH8FRKMJqhMU8mLFMZLGN7j6tH'
      );
    });

    it('should preserve the CID generated below the chunk boundary', function () {
      return expectHash(
        'a'.repeat(CHUNK_SIZE - 1),
        'QmdVN4PkHDK1i6UVAqE9r9tM9AtZnh6YcQ6144VESH2z3u'
      );
    });

    it('should preserve the CID generated at the chunk boundary', function () {
      return expectHash(
        'a'.repeat(CHUNK_SIZE),
        'Qma81h2ZqbvJW2EQkiVUZ17aSvNWqAtvUPhh8mQBPU8W7c'
      );
    });

    it('should preserve the CID generated above the chunk boundary', function () {
      return expectHash(
        'a'.repeat(CHUNK_SIZE + 1),
        'QmTaxvXcxpzzaatSEEAYr7t3knkJ6DmTVbr8MjJJWLRWpV'
      );
    });

    it('should preserve JSON property insertion order', async function () {
      const firstHash = await Ipfs.hashData({ first: 1, second: 2 });
      const secondHash = await Ipfs.hashData({ second: 2, first: 1 });

      expect(firstHash).not.to.equal(secondHash);
    });
  });
});
