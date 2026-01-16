const mongoose = require('mongoose');
const { isEmpty } = require('lodash');
const Entity = require('@common/lib/Entity');

class OrderComponentService {
  static async findOne(data, { lean = true } = {}) {
    const _doc = mongoose.model('OrderComponent')(data);

    const filter = _doc.uniquePath();
    if (isEmpty(filter)) throw new Error('Empty filter');

    return mongoose.model('OrderComponent').findOne(filter).lean(lean);
  }

  static async updateInitialCaller(data, replace = false) {
    const filter = {
      'entity.uuid': Entity.toEntity(data.entity).uuid,
      'crew.uuid': Entity.toEntity(data.crew).uuid,
      orderType: data.orderType,
      product: data.product,
      price: data.price,
      'storage.uuid': Entity.toEntity(data.storage).uuid,
      storageSlot: data.storageSlot
    };
    const document = await mongoose.model('OrderComponent').findOne(filter);

    if (document) {
      if (document.initialCaller && replace === false) return;
      await mongoose.model('OrderComponent').updateOne(filter, { initialCaller: data.initialCaller });
    }
  }
}

module.exports = OrderComponentService;
