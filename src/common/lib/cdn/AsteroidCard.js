// TODO: abstract these CDN classes into a single class with configuration
const Cdn = require('../Cdn');

class AsteroidCard extends Cdn {
  static BASE_KEY_PATH = 'influence';

  getKey({ doc, fileType }) {
    return `${this.getKeyPrefix(doc)}/${doc.id}.${fileType.toLowerCase()}`;
  }

  getKeyPrefix(doc) {
    return `${AsteroidCard.BASE_KEY_PATH}/${Cdn.envKey}/images/asteroids/${doc.id}`;
  }

  getInvalidationPaths(doc) {
    const prefix = this.getKeyPrefix(doc);
    const body = { bucket: this.bucket, key: prefix };
    const encoded = `${btoa(JSON.stringify(body).slice(0, -2))}`.replaceAll('=', '');

    return [`/${prefix}*`, `/${encoded}*`];
  }

  async purge(doc) {
    const paths = this.getInvalidationPaths(doc);
    await this.removeAll(['png', 'svg'].map((fileType) => this.getKey({ doc, fileType })));
    await this.invalidateAll(paths);
  }

  getAsset({ doc, fileType }) {
    return super.getAsset(this.getKey({ doc, fileType }));
  }

  upload({ contentType, data, doc, fileType }) {
    return super.upload({
      contentType,
      data,
      key: this.getKey({ doc, fileType })
    });
  }
}

module.exports = AsteroidCard;
