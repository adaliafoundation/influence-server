require('module-alias/register');
require('dotenv').config({ silent: true });
const axios = require('axios');
const { Entity } = require('@influenceth/sdk');
const { mongoose } = require('@common/storage/db');

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

const main = async function () {
  const snapshotUrl = 'https://influence.infura-ipfs.io/ipfs/QmPjtFx2b8gx4kBEX3xZmCafmyWdfDj8UkNqfQGmFvtg4U';
  const { data: snapshot } = await axios.get(snapshotUrl);
  let count = 0;

  for (const crewmate of snapshot) {
    const crewmateData = {
      entity: { id: crewmate.i, label: Entity.IDS.CREWMATE },
      appearance: packAppearance(
        crewmate.appearance.gender,
        crewmate.appearance.body,
        crewmate.appearance.face,
        crewmate.appearance.hair,
        crewmate.appearance.hair_color,
        crewmate.appearance.clothes,
        crewmate.appearance.head,
        crewmate.appearance.item
      ),
      class: crewmate.class,
      coll: crewmate.collection,
      title: crewmate.title
    };

    await mongoose.model('CrewmateComponent')
      .updateOne({ entity: crewmateData.entity }, crewmateData, { upsert: true });

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
