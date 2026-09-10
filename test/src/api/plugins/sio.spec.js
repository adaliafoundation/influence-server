const { expect } = require('chai');
const appConfig = require('config');
const { createServer } = require('node:http');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const { io } = require('socket.io-client');
const SocketIoServer = require('@api/plugins/sio');

describe('SocketIoServer authorization', function () {
  const authorize = (socket) => new Promise((resolve) => {
    SocketIoServer.authorizeSocket(socket, resolve);
  });

  it('should allow guest connections without a token', async function () {
    const socket = { handshake: { query: {} }, request: { headers: {} } };

    const error = await authorize(socket);

    expect(error).to.equal(undefined);
    expect(socket.auth).to.deep.equal({ isAuthenticated: false });
  });

  it('should authenticate a valid bearer token', async function () {
    const token = jwt.sign({ sub: '0x123' }, appConfig.get('App.jwtSecret'));
    const socket = {
      handshake: { query: {} },
      request: { headers: { authorization: `Bearer ${token}` } }
    };

    const error = await authorize(socket);

    expect(error).to.equal(undefined);
    expect(socket.auth.isAuthenticated).to.equal(true);
    expect(socket.auth.decoded_token.sub).to.equal('0x123');
  });

  it('should reject an invalid token', async function () {
    const socket = {
      handshake: { query: { token: 'invalid' } },
      request: { headers: {} }
    };

    const error = await authorize(socket);

    expect(error).to.have.property('name', 'JsonWebTokenError');
    expect(socket.auth).to.deep.equal({ isAuthenticated: false });
  });

  it('should authenticate a real Socket.IO handshake with a query token', async function () {
    const httpServer = createServer();
    const socketServer = new Server(httpServer, { transports: ['websocket'] });
    socketServer.use(SocketIoServer.authorizeSocket);

    await new Promise((resolve) => {
      httpServer.listen(0, '127.0.0.1', resolve);
    });
    const { port } = httpServer.address();
    const token = jwt.sign({ sub: '0x456' }, appConfig.get('App.jwtSecret'));
    const client = io(`http://127.0.0.1:${port}`, {
      query: { token },
      reconnection: false,
      transports: ['websocket']
    });

    try {
      const auth = await new Promise((resolve, reject) => {
        socketServer.once('connection', (socket) => resolve(socket.auth));
        client.once('connect_error', reject);
      });

      expect(auth.isAuthenticated).to.equal(true);
      expect(auth.decoded_token.sub).to.equal('0x456');
    } finally {
      client.close();
      await new Promise((resolve) => {
        socketServer.close(resolve);
      });
    }
  });
});
