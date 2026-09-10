require('module-alias/register');
require('dotenv').config({ silent: true });
const appConfig = require('config');
const Koa = require('koa');
const { createServer } = require('http');
const serveStatic = require('koa-static');
const cors = require('@koa/cors');
const ratelimit = require('koa-ratelimit');
const compress = require('koa-compress');
const { isWhiteList } = require('@api/plugins/origin');
const requestLogging = require('./plugins/requestLogging');
const { createHealthMiddleware } = require('./plugins/health');
const logger = require('../common/lib/logger');
require('@common/storage/db'); // db connection and init models
const controllers = require('./controllers');
const SocketIoServer = require('./plugins/sio');

const port = appConfig.get('App.port');
const server = new Koa();
const httpServer = createServer(server.callback());
const socketIoServer = new SocketIoServer(httpServer);

server.on('error', (error) => logger.error(error));
server.use(createHealthMiddleware(socketIoServer));
server.use(requestLogging);

// Serve static files
server.use(serveStatic(`${__dirname}/../common/assets`));

// Middleware
server.use(cors());
server.use(ratelimit({
  driver: 'memory',
  db: new Map(),
  duration: 10000,
  errorMessage: 'API is rate-limited to 5 requests per second',
  id: (ctx) => ((ctx.state.user && ctx.state.user.sub) ? ctx.state.user.sub : ctx.ip),
  max: 50,
  whitelist: isWhiteList
}));

server.use(compress());

// load api standard routes
if (Number(appConfig.get('App.isApiServer')) === 1) {
  Object.entries(controllers).forEach(([name, router]) => {
    if (name !== 'images') server.use((router.router || router).routes());
  });
}

// load routes for the images server
if (Number(appConfig.get('App.isImagesServer')) === 1) server.use(controllers.images.routes());

httpServer.listen(port, () => logger.info(`API and SocketIO Server listening on ${port}`));
socketIoServer.connect().catch((error) => {
  logger.error(error);
  process.exit(1);
});
