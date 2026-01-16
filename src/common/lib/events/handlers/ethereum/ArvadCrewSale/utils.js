const appConfig = require('config');
const web3 = require('@common/lib/web3');
const { ethereumContracts } = require('@influenceth/sdk');
const { num: { toHex } } = require('starknet');

const unpackFeatures = function (inFeatures) {
  const features = BigInt(inFeatures);
  return {
    crewCollection: Number(features & BigInt((2 ** 8) - 1)),
    gender: Number((features >> BigInt(8)) & BigInt((2 ** 2) - 1)),
    body: Number((features >> BigInt(10)) & BigInt((2 ** 16) - 1)),
    crewClass: Number((features >> BigInt(26)) & BigInt((2 ** 8) - 1)),
    title: Number((features >> BigInt(34)) & BigInt((2 ** 16) - 1)),
    clothes: Number((features >> BigInt(50)) & BigInt((2 ** 16) - 1)),
    hair: Number((features >> BigInt(66)) & BigInt((2 ** 16) - 1)),
    face: Number((features >> BigInt(82)) & BigInt((2 ** 16) - 1)),
    hairColor: Number((features >> BigInt(98)) & BigInt((2 ** 8) - 1)),
    head: Number((features >> BigInt(106)) & BigInt((2 ** 8) - 1)),
    item: Number((features >> BigInt(114)) & BigInt((2 ** 8) - 1))
  };
};

const packAppearance = function (gender, body, face, hair, hairColor, clothes, head, item) {
  let appearance = 0n;
  appearance += BigInt(gender) * 2n ** 0n;
  appearance += BigInt(body) * 2n ** 4n;
  appearance += BigInt(face) * 2n ** 20n;
  appearance += BigInt(hair) * 2n ** 36n;
  appearance += BigInt(hairColor) * 2n ** 52n;
  appearance += BigInt(clothes) * 2n ** 68n;
  appearance += BigInt(head) * 2n ** 84n;
  appearance += BigInt(item) * 2n ** 100n;

  return appearance;
};

const getFeaturesAndAppearance = async function (crewId) {
  const CONTRACT_CREW_FEATURES = appConfig.get('Contracts.ethereum.crewFeatures');

  const crewFeatures = new web3.eth.Contract(ethereumContracts.CrewFeatures, CONTRACT_CREW_FEATURES);
  const packedFeatures = await crewFeatures.methods.getFeatures(crewId).call();
  if (!packedFeatures) return { appearance: null, features: null };

  const features = unpackFeatures(packedFeatures);
  const appearance = packAppearance(
    features.gender,
    features.body,
    features.face,
    features.hair,
    features.hairColor,
    features.clothes,
    features.head,
    features.item
  );

  return {
    appearance: toHex(BigInt(appearance)),
    features: {
      class: features.crewClass,
      coll: features.crewCollection,
      title: features.title
    }
  };
};

module.exports = {
  getFeaturesAndAppearance,
  packAppearance,
  unpackFeatures
};
