require('module-alias/register');
require('dotenv').config({ silent: true });
const axios = require('axios');
const { Entity } = require('@influenceth/sdk');
const { mongoose } = require('@common/storage/db');

const main = async function () {
  const snapshotUrl = 'https://influence.infura-ipfs.io/ipfs/QmdJ7kY74efg8PvcbZ7AzuVdfZAksUiAVUL7koznvYWUq4';
  const { data: snapshot } = await axios.get(snapshotUrl);
  let count = 0;

  for (const asteroid of snapshot) {
    const { purchaseOrder, mintedCrewId } = asteroid;
    const reward = { entity: { id: asteroid.i, label: Entity.IDS.ASTEROID } };

    if (purchaseOrder > 0 && purchaseOrder <= 11468) {
      if (purchaseOrder > 0 && purchaseOrder <= 1859) reward.hasArrivalStarterPack = true;
      if (purchaseOrder > 11100 && purchaseOrder <= 11468) reward.hasPrepareForLaunchCrewmate = true;
      if (purchaseOrder > 0 && purchaseOrder <= 11100) {
        reward.hasMintableCrewmate = !(mintedCrewId > 0 && mintedCrewId <= 8663);
      }

      await mongoose.model('AsteroidRewardComponent').updateOne({ entity: reward.entity }, reward, { upsert: true });
    }

    count += 1;
    if (count % 100 === 0) console.log('.');
    if (count % 1000 === 0) console.log('Completed:', count);
  }
};

main()
  .then(() => {
    console.log('done');
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
