require('module-alias/register');
require('dotenv').config({ silent: true });
const sinon = require('sinon');
const appConfig = require('config');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const jwt = require('jsonwebtoken');
const http = require('http');
const request = require('supertest');
const Koa = require('koa');
const { delay } = require('lodash');
const { Address } = require('@influenceth/sdk');
const utils = require('@test/utils');
const UserFactory = require('../factories/User');

let mongoServer;
const logger = console;
const TEST_ADDRESS = Address.toStandard('0x1fB055014d8452e590FE692A670D20eA4ed61BAf');
const TEST_STARKNET_WALLET = Address.toStandard('0x0669B0254bce827409e794EB6146d355Ed0dE3A7306ab8E4CDA9ed8C5A48b09d');

// in preparation for mongoose 7
mongoose.set('strictQuery', true);

exports.mochaHooks = {
  async beforeAll() {
    logger.info('Setting up test mongodb server...');
    mongoServer = await MongoMemoryServer.create({ binary: { version: '6.0.14' } });
    this.mongoUri = mongoServer.getUri();

    // Set the mongo uri in the app config
    appConfig.MongoDb.uri = this.mongoUri;

    // we need to set the mongo uri in the config before importing the primary db file
    require('@common/storage/db'); // eslint-disable-line global-require

    // await mongoose.connect(this.mongoUri);

    logger.info('Setting up suppertest server and api global vars...');
    // Create some api test credentials for API tests
    await mongoose.model('ApiKey').create({ name: 'Test Client', client_id: TEST_ADDRESS, client_secret: 'bar' });
    const token = jwt.sign({ sub: TEST_ADDRESS }, appConfig.get('App.jwtSecret'));
    const user = await UserFactory.createOne({ address: TEST_ADDRESS });
    const userToken = jwt.sign({ sub: user.address }, appConfig.get('App.jwtSecret'));

    // Spin up the webserver for testing routes
    const app = new Koa();
    const server = request(http.createServer(app.callback()));
    this.GLOBALS = {
      app,
      server,
      token,
      user,
      userToken,
      TEST_STARKNET_WALLET
    };
    this._sandbox = sinon.createSandbox();
    this.utils = utils;

    await new Promise((resolve) => {
      logger.info('waiting for 1s to allow the indices to be created');
      delay(resolve, 1000);
    });
  },

  async afterAll() {
    logger.info('Shutting down test mongodb server...');
    await mongoose.disconnect();
    await mongoServer.stop();
  },

  afterEach() {
    this._sandbox.restore();
  }
};
