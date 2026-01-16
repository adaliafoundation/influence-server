require('module-alias/register');
require('dotenv').config({ silent: true });
const axios = require('axios');
const { Merkle, Entity } = require('@influenceth/sdk');
const { mongoose } = require('@common/storage/db');

const main = async function () {
  const asteroidMerkleUrl = 'https://influence.infura-ipfs.io/ipfs/QmVS9yNQWMumTJ6wJLrMetKxyiEysuKZaoGjaTMQJTmjty';
  const { data: asteroidMerkle } = await axios.get(asteroidMerkleUrl);

  for (let id = 1; id <= 250000; id += 1) {
    const proofData = { entity: { id, label: Entity.IDS.ASTEROID } };
    proofData.proof = Merkle.generateProofFromTree(asteroidMerkle, id - 1).map((p) => `0x${p.toString(16)}`);
    await mongoose.model('AsteroidProofComponent').updateOne({ entity: proofData.entity }, proofData, { upsert: true });

    if (id % 100 === 0) process.stdout.write('.');
    if (id % 1000 === 0) console.log('Completed:', id);
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
