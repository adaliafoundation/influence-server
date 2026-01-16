const appConfig = require('config');
const { Server } = require('socket.io');
const { createClient } = require('redis');
const socketioJwt = require('socketio-jwt');
const { createAdapter } = require('@socket.io/redis-adapter');
const eventEmitter = require('@common/lib/sio/emitter');
const { Address } = require('@influenceth/sdk');
const { ALLOWED_ORIGINS } = require('@api/plugins/origin');
const logger = require('@common/lib/logger');
const AsteroidChatRoom = require('./sio/AsteroidChatRoom');

class SocketIoServer {
  constructor(httpServer) {
    const NODE_ENV = appConfig.util.getEnv('NODE_ENV');
    const REDIS_URL = appConfig.get('Redis.uri');
    const options = { url: REDIS_URL, pingInterval: 60000 };
    if (NODE_ENV !== 'development') Object.assign(options, { socket: { tls: true, rejectUnauthorized: false } });
    this.pubClient = createClient(options);
    this.subClient = this.pubClient.duplicate();

    this.pubClient.on('error', (error) => {
      logger.error(error.message || error);
    });

    this.subClient.on('error', (error) => {
      logger.error(error.message || error);
    });

    this.initSocketIoServer(httpServer);
    this.initPlugins();
    this.initListeners();
  }

  initSocketIoServer(httpServer) {
    this.sioServer = new Server(httpServer, {
      cors: {
        origin: ALLOWED_ORIGINS,
        methods: ['GET', 'POST'],
        credentials: true
      },
      transports: ['websocket']
    });
  }

  initPlugins() {
    this.sioServer.use(socketioJwt.authorize({
      secret: appConfig.get('App.jwtSecret'),
      handshake: true,
      decodedPropertyName: 'auth',
      customDecoded(decoded) {
        return { decoded_token: decoded, isAuthenticated: true };
      },
      fail(error, socket, accept) {
        let _error = error;
        let result = false;
        Object.assign(socket, { auth: { isAuthenticated: false } });
        // allow null/empty credentials to pass through
        if (error?.data?.code === 'credentials_required') {
          _error = null;
          result = true;
        }
        if (socket.request) {
          accept(_error);
        } else {
          accept(null, result);
        }
      }
    }));
  }

  initAuthenticatedListeners(socket) {
    socket.on('join-room-request', ({ id, type }) => {
      if (!id || !type) return;

      const room = `${type}::${id}`;
      socket.join(room);
    });

    socket.on('leave-room-request', ({ id, type }) => {
      if (!id || !type) return;

      const room = `${type}::${id}`;
      socket.leave(room);
    });
  }

  joinAddressRoom(socket) {
    if (!socket) throw new Error('Missing socket');

    // add each socket to the address room by default
    const address = socket.auth?.decoded_token?.sub;
    if (!address) return;
    const addressRoom = Address.toStandard(address);
    logger.debug(`joining socket to address room, ${addressRoom}`);
    if (addressRoom) socket.join(addressRoom);
  }

  initListeners() {
    this.sioServer.on('connection', async (socket) => {
      if (socket.auth.isAuthenticated) {
        this.joinAddressRoom(socket);
        this.initAuthenticatedListeners(socket);

        // Enable authenticated sockets to send messages in asteroid chat room
        AsteroidChatRoom.enableSendMessaging(socket, eventEmitter);
      }

      // authenticated users and guest users can join the public room
      AsteroidChatRoom.join(socket);
    });
  }

  async connect() {
    await Promise.all([this.pubClient.connect(), this.subClient.connect()]);
    this.sioServer.adapter(createAdapter(this.pubClient, this.subClient));
  }
}

module.exports = SocketIoServer;
