const { isEmpty } = require('lodash');

class Factory {
  static makeOne() {
    throw new Error('Must implement in subclass');
  }

  static async createOne(options = {}) {
    const doc = await this.makeOne(options);
    return doc.save();
  }

  static async createMulti(count, options = {}) {
    const docs = [];
    for (let i = 0; i < count; i += 1) {
      const doc = await this.createOne(options);
      docs.push(doc);
    }
    return docs;
  }

  static getModel() {
    throw new Error('Must implement in subclass');
  }

  static remove(query) {
    if (isEmpty(query)) throw new Error('Empty query');
    return this.getModel().remove(query);
  }

  static purge() {
    return this.getModel().deleteMany({ _id: { $ne: null } });
  }
}

module.exports = Factory;
