const Cdn = require('../Cdn');

class CrewCard extends Cdn {
  static BASE_KEY_PATH = 'influence';

  getKey({ doc, fileType }) {
    return `${this.getKeyPrefix(doc)}/${doc.id}.${fileType.toLowerCase()}`;
  }

  getKeyPrefix(doc) {
    return `${CrewCard.BASE_KEY_PATH}/${Cdn.envKey}/images/crews/${doc.id}`;
  }

  getInvalidationPaths(doc) {
    const prefix = this.getKeyPrefix(doc);
    const body = { bucket: this.bucket, key: prefix };
    const encoded = `${btoa(JSON.stringify(body).slice(0, -2))}`.replaceAll('=', '');

    return [`/${prefix}*`, `/${encoded}*`];
  }

  async purge(doc) {
    const prefix = this.getKeyPrefix(doc);
    const paths = this.getInvalidationPaths(doc);
    const assets = await this.getAssets(prefix);
    if (assets.length > 0) await this.removeAll(assets.map(({ key }) => key));
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

module.exports = CrewCard;
