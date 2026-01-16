const Cdn = require('../Cdn');

class CrewmateCard extends Cdn {
  static BASE_KEY_PATH = 'influence';

  getKey({ doc, fileType, bustOnly = false }) {
    const suffix = (bustOnly) ? '_bo' : '';
    return `${this.getKeyPrefix(doc)}/${doc.id}${suffix}.${fileType.toLowerCase()}`;
  }

  getKeyPrefix(doc) {
    return `${CrewmateCard.BASE_KEY_PATH}/${Cdn.envKey}/images/crew/${doc.id}`;
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

  getAsset({ bustOnly, doc, fileType }) {
    return super.getAsset(this.getKey({ bustOnly, doc, fileType }));
  }

  upload({ contentType, bustOnly, data, doc, fileType }) {
    return super.upload({
      contentType,
      data,
      key: this.getKey({ bustOnly, doc, fileType })
    });
  }
}

module.exports = CrewmateCard;
