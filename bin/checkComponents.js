/* eslint-disable guard-for-in */
require('module-alias/register');
require('dotenv').config({ silent: true });
const { mongoose } = require('@common/storage/db');

const componentsToCheck = [];

const main = async function () {
  const eventModel = mongoose.model('Event');

  for (let i = 0; i < componentsToCheck.length; i += 1) {
    const componentType = componentsToCheck[i];
    const componentModel = mongoose.model(`${componentType}Component`);
    const cursor = componentModel.find().cursor();
    let count = 0;

    console.log(`Checking ${componentType} components`);

    // 'entity.uuid', 'permission', 'permitted.uuid'
    for await (const doc of cursor) {
      const lastEvent = await eventModel.findOne({
        'returnValues.entity.id': doc.entity?.id,
        'returnValues.entity.label': doc.entity?.label,
        'returnValues.permission': doc.permission,
        'returnValues.permitted.id': doc.permitted?.id,
        'returnValues.permitted.label': doc.permitted?.label,
        name: `ComponentUpdated_${componentType}`
      }).sort({ blockNumber: -1, transactionIndex: -1, logIndex: -1 });

      if (doc.event && lastEvent && doc.event.id.toString() !== lastEvent.id.toString()) {
        console.log(`Found a mismatch for ${componentType}, ${doc.entity.label}, ${doc.entity.id}:
          ${doc.id.toString()}`);

        lastEvent.lastProcessed = null;
        await lastEvent.save();
        console.log('Updated lastProcessed');
      }

      count += 1;

      if (count % 100 === 0) {
        console.log(`Processed ${count} documents`);
      }
    }
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
