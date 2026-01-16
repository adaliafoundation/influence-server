const appConfig = require('config');
const router = require('@koa/router')();
const cors = require('@koa/cors');
const bodyParser = require('koa-bodyparser');
const jwt = require('jsonwebtoken');
const { allowedOrigin } = require('@api/plugins/origin');
const ApiKeyService = require('@common/services/ApiKey');
const AuthService = require('@common/services/Auth');

// Returns a challenge message valid for a short period of time
const getAuthChallenge = async (ctx) => {
  if (!ctx.params?.address) ctx.throw(400, 'Address is required');
  const message = await AuthService.getChallenge(ctx.params.address);
  ctx.type = 'application/json';
  ctx.body = { message };
};

// Validates a signed message from a given address and checks against cache
const verifyAuthChallenge = async (ctx) => {
  const { params: { address } } = ctx;
  const { message, referredBy, signature } = ctx.request.body;

  if (!address || !signature) ctx.throw(400, 'Address and signature are required');

  try {
    const user = await AuthService.verifyChallenge({ address, message, referredBy, signature });

    // Generate a JWT and return it
    const token = jwt.sign({ sub: user.address }, appConfig.get('App.jwtSecret'), { expiresIn: '7 days' });
    ctx.body = { token };
    ctx.status = 200;
  } catch (error) {
    ctx.status = 401;
    ctx.body = { error: error.message };
  }
};

// Generates a token for client credential users
const generateClientToken = async (ctx) => {
  const { grant_type: grantType, client_id: clientId, client_secret: clientSecret } = ctx.request.body;

  // Only client_credentials grant type is supported
  if (grantType !== 'client_credentials') {
    ctx.body = { error: 'unsupported_grant_type' };
    ctx.status = 400;
    return;
  }

  // Error if appropriate arguments not present
  if (!clientId || !clientSecret) {
    ctx.body = { error: 'invalid_request' };
    ctx.status = 400;
    return;
  }

  const key = await ApiKeyService.findByClient(clientId);

  // If the record doesn't exist
  if (!key) {
    ctx.body = { error: 'invalid_client' };
    ctx.status = 401;
    return;
  }

  const valid = key.validSecret(clientSecret);

  // If the passed secret isn't valid
  if (!valid) {
    ctx.body = { error: 'invalid_client' };
    ctx.status = 401;
    return;
  }

  // Everything is valid, generate and return token
  const token = jwt.sign({ sub: clientId }, appConfig.get('App.jwtSecret'));
  ctx.body = { access_token: token, token_type: 'bearer' };
  ctx.status = 200;
};

// Setup routes
router.use(cors({ origin: allowedOrigin }));
router.use(bodyParser());
router.get('/v1/auth/login/:address', getAuthChallenge);
router.get('/v2/auth/login/:address', getAuthChallenge);
router.post('/v1/auth/login/:address', verifyAuthChallenge);
router.post('/v2/auth/login/:address', verifyAuthChallenge);
router.post('/v1/auth/token', generateClientToken);
router.post('/v2/auth/token', generateClientToken);

module.exports = router;
