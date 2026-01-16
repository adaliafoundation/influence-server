require('module-alias/register');
require('dotenv').config({ silent: true });
const axios = require('axios');
const Entity = require('@common/lib/Entity');
const { mongoose } = require('@common/storage/db');

const main = async function () {
  const snapshotUrl = 'https://influence.infura-ipfs.io/ipfs/QmPjtFx2b8gx4kBEX3xZmCafmyWdfDj8UkNqfQGmFvtg4U';
  const { data: snapshot } = await axios.get(snapshotUrl);
  let count = 0;

  for (const crewmate of snapshot) {
    const entity = await mongoose.model('Entity').findOne({ uuid: Entity.Crewmate(crewmate.i).uuid });

    if (!entity) await mongoose.model('Entity').create(Entity.Crewmate(crewmate.i));

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
