const appConfig = require('config');
const { Emitter: RedisEmitter } = require('@socket.io/redis-emitter');
const { createClient } = require('redis');
const logger = require('@common/lib/logger');

class EventEmitter {
  #emitter;

  #redisClient;

  constructor() {
    const options = { url: appConfig.get('Redis.uri'), pingInterval: 60000 };
    if (appConfig.util.getEnv('NODE_ENV') !== 'development') {
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

  get isConnected() {
    return this.#redisClient.isOpen;
  }

  async emitTo({ body, eventName = 'event', to, room, type }) {
    if (!this.isConnected) await this.#redisClient.connect();
    if (!to) throw new Error('Missing required `to` param');
    this.#emitter.to(to).emit(eventName, { body, room, type });
  }

  async broadcast({ body, eventName = 'event', type }) {
    if (!this.isConnected) await this.#redisClient.connect();
    this.#emitter.emit(eventName, { type, body });
  }
}

module.exports = new EventEmitter();
