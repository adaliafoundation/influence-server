require('module-alias/register');
require('dotenv').config({ silent: true });
const axios = require('axios');
const { Entity } = require('@influenceth/sdk');
const { constants } = require('@influenceth/astro');
const { mongoose } = require('@common/storage/db');

const main = async function () {
  const snapshotUrl = 'https://influence.infura-ipfs.io/ipfs/QmdJ7kY74efg8PvcbZ7AzuVdfZAksUiAVUL7koznvYWUq4';
  const { data: snapshot } = await axios.get(snapshotUrl);
  let count = 0;

  for (const asteroid of snapshot) {
    const orbit = {
      entity: { id: asteroid.i, label: Entity.IDS.ASTEROID },
      a: (asteroid.orbital.a * constants.AU) / 1000,
      ecc: asteroid.orbital.e,
      inc: asteroid.orbital.i,
      raan: asteroid.orbital.o,
      argp: asteroid.orbital.w,
      m: asteroid.orbital.m
    };

    await mongoose.model('OrbitComponent').updateOne({ entity: orbit.entity }, orbit, { upsert: true });

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
