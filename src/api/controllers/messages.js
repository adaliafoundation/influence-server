const appConfig = require('config');
const KoaRouter = require('@koa/router');
const bodyParser = require('koa-bodyparser');
const cors = require('@koa/cors');
const koaJwt = require('koa-jwt');
const corsOrJwt = require('@api/plugins/corsOrJwt');
const { allowedOrigin } = require('@api/plugins/origin');
const { DirectMessageService } = require('@common/services');
const UserService = require('../../common/services/User');

const createMessage = async function (ctx) {
  const {
    request: { body: { encryptedMessage, event, recipient } },
    state: { user: { sub: caller } }
  } = ctx;
  if (!caller) ctx.throw(401, 'Not authorized');

  try {
    const result = await DirectMessageService.findOrCreate({
      caller,
      event,
      message: encryptedMessage,
      pin: true,
      recipient
    });

    ctx.status = 200;
    ctx.body = result;
  } catch (error) {
    ctx.throw(400, error.message);
  }
};

const getHash = async function (ctx) {
  const { request: { body: { encryptedMessage } } } = ctx;
  ctx.status = 200;
  try {
    await DirectMessageService.validate(encryptedMessage);
  } catch (error) {
    ctx.body = { error: error.message };
    ctx.status = 400;
    return;
  }

  const hash = await DirectMessageService.hashData(encryptedMessage);

  ctx.status = 200;
  ctx.body = { hash };
};

const getMessages = async function (ctx) {
  const { state: { user: { sub: recipient } } } = ctx;
  if (!recipient) ctx.throw(401, 'Not authorized');

  ctx.status = 200;
  ctx.body = await DirectMessageService.findBySenderOrRecipient(recipient);
};

const getRecipientPublicKey = async function (ctx) {
  const {
    params: { recipient },
    state: { user: { sub: loggedInUser } }
  } = ctx;
  if (!loggedInUser) ctx.throw(401, 'Not authorized');

  const recipientUser = await UserService.findByAddress(recipient);
  if (!recipientUser.publicKey) ctx.throw(404, 'Not found');

  ctx.status = 200;
  ctx.body = recipientUser.publicKey;
};

const markRead = async function (ctx) {
  const { params: { id }, state: { user: { sub: recipient } } } = ctx;
  if (!recipient) ctx.throw(401, 'Not authorized');

  await DirectMessageService.markRead(id, recipient);

  ctx.status = 200;
};

const router = new KoaRouter()
  .use(koaJwt({ secret: appConfig.get('App.jwtSecret'), passthrough: true }))
  .use(cors({ origin: allowedOrigin }))
  .use(corsOrJwt)
  .use(bodyParser())
  .get('/v2/messages/key/:recipient', getRecipientPublicKey)
  .patch('/v2/messages/:id/read', markRead)
  .post('/v2/messages/hash', getHash)
  .post('/v2/messages', createMessage)
  .get('/v2/messages', getMessages);

module.exports = router;
