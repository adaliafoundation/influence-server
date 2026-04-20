const appConfig = require('config');
const { Emitter: RedisEmitter } = require('@socket.io/redis-emitter');
const { createClient } = require('redis');
const logger = require('@common/lib/logger');

class EventEmitter {
  #emitter;

  #redisClient;

  #sioServer;

  constructor() {
    const redisUri = appConfig.has('Redis.uri') ? appConfig.get('Redis.uri') : '';
    if (!redisUri) return; // No Redis configured — use direct socket.io (set via setServer)

    const options = { url: redisUri, pingInterval: 60000 };
    if (!['development', 'docker'].includes(appConfig.util.getEnv('NODE_ENV'))) {
      Object.assign(options, { socket: { tls: true, rejectUnauthorized: false } });
    }
    this.#redisClient = createClient(options);
    this.#redisClient.on('error', (error) => {
      logger.error(`EventEmitter, redis connect error: ${error.message || error}`);
    });

    this.#redisClient.connect().then(() => {
      this.#emitter = new RedisEmitter(this.#redisClient);
    });
  }

  setServer(sioServer) {
    this.#sioServer = sioServer;
  }

  get isConnected() {
    if (this.#sioServer) return true;
    return this.#redisClient?.isOpen;
  }

  async emitTo({ body, eventName = 'event', to, room, type }) {
    if (!to) throw new Error('Missing required `to` param');
    if (this.#sioServer) {
      this.#sioServer.to(to).emit(eventName, { body, room, type });
      return;
    }
    if (!this.isConnected) await this.#redisClient.connect();
    this.#emitter.to(to).emit(eventName, { body, room, type });
  }

  async broadcast({ body, eventName = 'event', type }) {
    if (this.#sioServer) {
      this.#sioServer.emit(eventName, { type, body });
      return;
    }
    if (!this.isConnected) await this.#redisClient.connect();
    this.#emitter.emit(eventName, { type, body });
  }
}

module.exports = new EventEmitter();
