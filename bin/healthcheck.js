require('dotenv').config({ silent: true });
const { hostname } = require('os');
const appConfig = require('config');
const { mongo: { MongoClient } } = require('mongoose');
const { healthSettings, workerKey, isWorkerHealthy, WORKER_ROLES } = require('../src/common/lib/health');

async function main() {
  const role = process.argv[2] || 'api';
  const settings = healthSettings(appConfig);
  if (role === 'api') {
    const response = await fetch(`http://127.0.0.1:${appConfig.get('App.port')}/readyz`, {
      signal: AbortSignal.timeout(settings.timeoutMs + 1000)
    });
    if (!response.ok) throw new Error('API not ready');
    return;
  }
  if (!WORKER_ROLES.includes(role)) throw new Error('Invalid worker role');
  const client = new MongoClient(appConfig.get('MongoDb.uri'), {
    serverSelectionTimeoutMS: settings.timeoutMs, timeoutMS: settings.timeoutMs
  });
  try {
    await client.connect();
    const record = await client.db().collection('workerhealth').findOne({ _id: workerKey(settings, role) });
    if (!isWorkerHealthy(record, settings, Date.now(), hostname())) throw new Error('Worker not ready');
  } finally {
    await client.close();
  }
}

main().catch(() => { process.exitCode = 1; });
