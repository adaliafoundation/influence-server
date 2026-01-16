const appConfig = require('config');
const KoaRouter = require('@koa/router');
const koaJwt = require('koa-jwt');
const cors = require('@koa/cors');
const corsOrJwt = require('@api/plugins/corsOrJwt');
const { allowedOrigin } = require('@api/plugins/origin');
const Stripe = require('stripe');

const getProducts = async function (ctx) {
  const instance = Stripe(appConfig.get('Stripe.secretKey'));

  const [products, prices] = await Promise.all([
    instance.products.list({ active: true, limit: 100 }),
    instance.prices.list({ active: true, limit: 100 })
  ]);

  ctx.body = products.data.map((product) => {
    const productPrice = prices.data.find((p) => p.product === product.id);
    return {
      id: product.id,
      amount: productPrice?.unit_amount,
      currency: productPrice?.currency,
      name: product.name,
      description: product.description,
      metadata: product.metadata
    };
  });
};

const createSaleIntent = async function (ctx) {
  const { params: { sku }, state: { user: { sub: address } } } = ctx;
  if (!address) ctx.throw(401, 'Not authorized');

  const instance = Stripe(appConfig.get('Stripe.secretKey'));

  const product = await instance.products.retrieve(sku);
  if (!product?.active) ctx.throw(400, 'Invalid sku');
  const price = await instance.prices.retrieve(product.default_price);
  if (!price?.active) ctx.throw(400, 'Invalid price');

  const paymentIntent = await instance.paymentIntents.create({
    amount: price.unit_amount,
    currency: price.currency,
    automatic_payment_methods: { enabled: true }
  });

  if (!paymentIntent?.client_secret) ctx.throw(500, 'Failed to create payment intent');

  ctx.body = { clientSecret: paymentIntent.client_secret };
};

// Setup routes
const router = new KoaRouter()
  .use(koaJwt({ secret: appConfig.get('App.jwtSecret'), passthrough: true }))
  .use(cors({ origin: allowedOrigin }))
  .use(corsOrJwt)
  .get('/v2/stripe', getProducts)
  .post('/v2/stripe/:sku', createSaleIntent);

module.exports = router;
