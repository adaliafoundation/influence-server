require('module-alias/register');
require('dotenv').config({ silent: true });
const appConfig = require('config');
const Koa = require('koa');
const { createServer } = require('http');
const serveStatic = require('koa-static');
const cors = require('@koa/cors');
const ratelimit = require('koa-ratelimit');
const compress = require('koa-compress');
const koaLogger = require('koa-logger');
const { isWhiteList } = require('@api/plugins/origin');
const logger = require('../common/lib/logger');
require('@common/storage/db'); // db connection and init models
const controllers = require('./controllers');
const SocketIoServer = require('./plugins/sio');

const port = appConfig.get('App.port');
const server = new Koa();
const httpServer = createServer(server.callback());
const socketIoServer = new SocketIoServer(httpServer);

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
server.use(koaLogger((str, args) => {
  const [,,, status] = args;
  if (status < 400) logger.debug(str); // Informational, success, and redirects
  if (status >= 400 && status < 500) logger.warn(str); // Client error responses
  if (status >= 500) logger.error(str); // Server error responses
}));

// load api standard routes
if (Number(appConfig.get('App.isApiServer')) === 1) {
  Object.entries(controllers).forEach(([name, router]) => {
    if (name !== 'images') server.use((router.router || router).routes());
  });
}

// load routes for the images server
if (Number(appConfig.get('App.isImagesServer')) === 1) server.use(controllers.images.routes());

socketIoServer.connect()
  .then(() => {
    httpServer.listen(port);
    logger.info(`API and SocketIO Server listing on ${port}`);
  });
