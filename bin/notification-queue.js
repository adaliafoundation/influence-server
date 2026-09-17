const mongoose = require('mongoose');
const config = require('config');

async function main() {
  const connection = await mongoose.createConnection(config.get('MongoDb.uri'), {
    autoIndex: false,
    serverSelectionTimeoutMS: 10000
  }).asPromise();
  try {
    const now = new Date();
    const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const notifications = connection.collection('notifications');
    const due = { notifyOn: { $gte: cutoff, $lte: now } };
    const [eligible, older, future, oldest] = await Promise.all([
      notifications.countDocuments(due),
      notifications.countDocuments({ notifyOn: { $lt: cutoff } }),
      notifications.countDocuments({ notifyOn: { $gt: now } }),
      notifications.find(due, { projection: { _id: 0, notifyOn: 1 } })
        .sort({ notifyOn: 1 }).limit(1).toArray()
    ]);
    console.log(JSON.stringify({
      checkedAt: now.toISOString(),
      eligibleDocuments: eligible,
      olderThan30Days: older,
      futureDocuments: future,
      oldestEligibleAt: oldest[0]?.notifyOn || null
    }, null, 2));
  } finally {
    await connection.close();
  }
}

main().catch(error => {
  console.error(`Unable to inspect notification queue (${error.name || 'Error'})`);
  process.exitCode = 1;
});
