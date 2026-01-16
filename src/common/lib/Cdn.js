const appConfig = require('config');
const {
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsCommand,
  PutObjectCommand,
  S3Client } = require('@aws-sdk/client-s3');
const { CloudFrontClient, CreateInvalidationCommand } = require('@aws-sdk/client-cloudfront');
const uuid = require('short-uuid');
const logger = require('./logger');

const AWS_BASE_DOMAIN = 's3.amazonaws.com';

class Cdn {
  #_s3client;

  #_cloudFrontClient;

  #_bucket;

  #_cloudFrontEndpoint;

  #_cloudFrontDistribution;

  #_imageHandlerEndpoint;

  #_imageHandlerDistribution;

  constructor() {
    if (!this.isEnabled()) {
      logger.warn('CDN is currently disabled. Check env vars.');
      return;
    }

    const AWS_ACCESS_KEY = appConfig.get('Aws.accessKey');
    const AWS_CLOUDFRONT_DISRIBUTION_ID = appConfig.get('Aws.cloudfront.distrbutionId');
    const AWS_CLOUDFRONT_IMAGE_HANDLER_DISRIBUTION_ID = appConfig.get('Aws.cloudfront.distrbutionId');
    const AWS_REGION = appConfig.get('Aws.region');
    const AWS_SECRET_ACCESS_KEY = appConfig.get('Aws.secretAccessKey');
    const CDN_AWS_BUCKET = appConfig.get('Cdn.awsBucket');
    const CDN_CLOUDFRONT_URL = appConfig.get('Cdn.cloudfrontUrl');
    const CDN_IMAGE_HANDLER_URL = appConfig.get('Cdn.imageHandlerUrl');

    this.#_bucket = CDN_AWS_BUCKET;
    this.#_imageHandlerEndpoint = CDN_IMAGE_HANDLER_URL;
    this.#_imageHandlerDistribution = AWS_CLOUDFRONT_IMAGE_HANDLER_DISRIBUTION_ID;
    this.#_cloudFrontEndpoint = CDN_CLOUDFRONT_URL;
    this.#_cloudFrontDistribution = AWS_CLOUDFRONT_DISRIBUTION_ID;

    this.initS3Client({
      accessKey: AWS_ACCESS_KEY,
      region: AWS_REGION,
      secretAccessKey: AWS_SECRET_ACCESS_KEY
    });

    this.initCloudFrontClient({
      accessKey: AWS_ACCESS_KEY,
      region: AWS_REGION,
      secretAccessKey: AWS_SECRET_ACCESS_KEY
    });
  }

  // getters/setters
  set bucket(value) {
    this.#_bucket = value;
  }

  get bucket() {
    return this.#_bucket;
  }

  get baseDomain() {
    return AWS_BASE_DOMAIN;
  }

  get s3client() {
    return this.#_s3client;
  }

  get cloudFrontClient() {
    return this.#_cloudFrontClient;
  }

  get cloudFrontEndpoint() {
    return this.#_cloudFrontEndpoint;
  }

  get imageHandlerEndpoint() {
    return this.#_imageHandlerEndpoint;
  }

  /**
   * Returns an environment key/string based on the current NODE_ENV
   * Defaults to 'development' if NODE_ENV is not set
   * @return {string}  envKey
   */
  static get envKey() {
    const NODE_ENV = appConfig.util.getEnv('NODE_ENV');
    const envKey = {
      development: 'dev',
      goerli: 'goerli',
      production: 'production',
      rinkeby: 'rinkeby',
      staging: 'staging',
      prerelease: 'prerelease'
    }[(NODE_ENV || 'development')];

    if (!envKey) {
      logger.warn(`Cdn::getEnvPath, Missing map for specified NODE_ENV ${NODE_ENV}, `
      + 'falling back to development value.');
    }

    return envKey;
  }

  // initalizers
  initS3Client(args = {}) {
    this.#_s3client = new S3Client({
      region: args.region,
      credentials: {
        accessKeyId: args.accessKey,
        secretAccessKey: args.secretAccessKey
      }
    });

    return this;
  }

  initCloudFrontClient(args = {}) {
    this.#_cloudFrontClient = new CloudFrontClient({
      region: args.region,
      credentials: {
        accessKeyId: args.accessKey,
        secretAccessKey: args.secretAccessKey
      }
    });

    return this;
  }

  // helpers
  isEnabled() {
    try {
      appConfig.get('Aws.accessKey');
      appConfig.get('Aws.cloudfront.distrbutionId');
      appConfig.get('Aws.cloudfront.distrbutionId');
      appConfig.get('Aws.region');
      appConfig.get('Aws.secretAccessKey');
      appConfig.get('Cdn.awsBucket');
      appConfig.get('Cdn.cloudfrontUrl');
      appConfig.get('Cdn.imageHandlerUrl');
      const CDN_ENABLED = appConfig.get('Cdn.enabled');
      return Number(CDN_ENABLED, 10) === 1;
    } catch (e) {
      return false;
    }
  }

  formatResult({ key, ...props }) {
    const _key = (key[0] === '/') ? key.slice(1) : key;
    return {
      bucket: this.bucket,
      key: _key,
      size: props.Size,
      url: `https://${this.bucket}.${this.baseDomain}/${_key}`
    };
  }

  /**
   * If the fileType is svg, the width/height are ignored and the basic cloudfront url is used
   * If the fileType is a png but no size options are spcified, the basic cloudfront url is used
   * If the fileType is a png and either width or height are specified, the imagehandler url is used
   * @return {string}  envKey
   */
  getUrl({ fileType, key, height, width }) {
    if (fileType === 'svg') return `${this.cloudFrontEndpoint}/${key}`;
    if (!height && !width) return `${this.cloudFrontEndpoint}/${key}`;
    const body = {
      buket: this.bucket,
      key,
      edits: { resize: { fit: 'cover', height, width } }
    };

    return `${this.imageHandlerEndpoint}/${btoa(JSON.stringify(body))}`;
  }

  // private methods
  async _remove(key) {
    try {
      const result = await this.s3client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
      return (result.$metadata.httpStatusCode === 204);
    } catch (error) {
      logger.warn(`Cdn::_remove: ${error.message || error}`);
      throw new Error(`Error removing the speicified asset, ${key}`);
    }
  }

  #enabledCheck() {
    if (!this.isEnabled()) throw new Error('CDN disabled');
  }

  // public methods
  async getAsset(key) {
    this.#enabledCheck();

    try {
      const response = await this.s3client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return (response.$metadata.httpStatusCode === 200) ? this.formatResult({ key }) : null;
    } catch (error) {
      if (error.$metadata.httpStatusCode === 404) return null;
      logger.warn(error.message);
      return null;
    }
  }

  async getAssets(keyPrefix) {
    this.#enabledCheck();

    const { Contents } = await this.s3client.send(new ListObjectsCommand({ Bucket: this.bucket, Prefix: keyPrefix }));
    return (Contents || []).map((item) => this.formatResult({ key: item.Key, ...item }));
  }

  async removeAll(keys) {
    this.#enabledCheck();

    try {
      await Promise.allSettled(keys.map((key) => this._remove(key)));
    } catch (error) {
      logger.warn(`Cdn::remove: ${error.message || error}`);
    }
  }

  async upload({ contentType, data, key }) {
    this.#enabledCheck();

    try {
      const response = await this.s3client.send(new PutObjectCommand({
        Body: data,
        Bucket: this.bucket,
        ContentType: contentType,
        Key: key
      }));
      if (response.$metadata.httpStatusCode !== 200) {
        throw new Error(`CDN::upload, unknown error: ${JSON.stringify(response)}`);
      }
    } catch (error) {
      throw new Error(`Error uploading image: ${error.message}`);
    }

    return this.formatResult({ key });
  }

  async invalidateAll(paths) {
    this.#enabledCheck();

    return Promise.allSettled([
      this.invalidateCloudFront(paths),
      this.invalidateImageHandler(paths)
    ]);
  }

  async invalidateCloudFront(paths) {
    this.#enabledCheck();

    return this.cloudFrontClient.send(new CreateInvalidationCommand({
      DistributionId: this.#_cloudFrontDistribution,
      InvalidationBatch: {
        CallerReference: uuid.uuid(),
        Paths: { Quantity: paths.length, Items: paths }
      }
    }));
  }

  async invalidateImageHandler(paths) {
    this.#enabledCheck();

    return this.cloudFrontClient.send(new CreateInvalidationCommand({
      DistributionId: this.#_imageHandlerDistribution,
      InvalidationBatch: {
        CallerReference: uuid.uuid(),
        Paths: { Quantity: paths.length, Items: paths }
      }
    }));
  }
}

module.exports = Cdn;
