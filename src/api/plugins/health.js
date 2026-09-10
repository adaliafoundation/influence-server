const appConfig = require('config');
const { db } = require('../../common/storage/db');
const ElasticSearch = require('../../common/storage/elasticsearch');
const { healthSettings, workerKey, isWorkerHealthy, createReadiness } = require('../../common/lib/health');

const healthMiddleware = require('./healthMiddleware');

function createHealthMiddleware(socketIoServer) {
  const settings = healthSettings(appConfig);
  const checks = {
    mongodb: async () => {
      if (db.readyState !== 1) return false;
      await db.db.command({ ping: 1 }, { timeoutMS: settings.timeoutMs });
      return true;
    },
    redis: async () => {
      if (!socketIoServer.pubClient.isReady || !socketIoServer.subClient.isReady) return false;
      return (await socketIoServer.pubClient.ping()) === 'PONG';
    },
    elasticsearch: async () => {
      const result = await ElasticSearch.client.cluster.health({}, {
        requestTimeout: settings.timeoutMs, maxRetries: 0
      });
      // A single-node cluster can legitimately be yellow because replicas cannot be allocated.
      return ['green', 'yellow'].includes(result.status) && !result.timed_out;
    }
  };
  for (const role of settings.requiredWorkers) {
    checks[role] = async () => {
      if (db.readyState !== 1) return false;
      const record = await db.collection('workerhealth').findOne({ _id: workerKey(settings, role) }, {
        maxTimeMS: settings.timeoutMs, timeoutMS: settings.timeoutMs
      });
      return isWorkerHealthy(record, settings);
    };
  }
  return healthMiddleware(createReadiness({ checks, timeoutMs: settings.timeoutMs }));
}

module.exports = { createHealthMiddleware, healthMiddleware };
