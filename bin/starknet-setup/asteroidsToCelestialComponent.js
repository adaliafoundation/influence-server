require('module-alias/register');
require('dotenv').config({ silent: true });
const axios = require('axios');
const { Asteroid, Entity } = require('@influenceth/sdk');
const { mongoose } = require('@common/storage/db');

const main = async function () {
  const snapshotUrl = 'https://influence.infura-ipfs.io/ipfs/QmdJ7kY74efg8PvcbZ7AzuVdfZAksUiAVUL7koznvYWUq4';
  const { data: snapshot } = await axios.get(snapshotUrl);
  let count = 0;

  for (const asteroid of snapshot) {
    const celestial = {
      entity: { id: asteroid.i, label: Entity.IDS.ASTEROID },
      bonuses: asteroid.bonuses || 0,
      celestialType: asteroid.spectralType + 1,
      mass: Math.round(Asteroid.getMass(asteroid.spectralType + 1, asteroid.r / 1000)),
      purchaseOrder: asteroid.purchaseOrder || 0,
      radius: asteroid.r / 1000,
      scanStatus: asteroid.scanStatus || 0
    };

    await mongoose.model('CelestialComponent').updateOne({ entity: celestial.entity }, celestial, { upsert: true });

    count += 1;
    if (count % 100 === 0) process.stdout.write('.');
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
