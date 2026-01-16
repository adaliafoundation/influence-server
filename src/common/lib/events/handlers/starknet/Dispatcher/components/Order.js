const { ComponentService, ElasticSearchService, OrderComponentService } = require('@common/services');

const BaseHandler = require('../../Handler');

class Handler extends BaseHandler {
  static eventConfig = {
    keys: [
      '0x297be67eb977068ccd2304c6440368d4a6114929aeb860c98b6a7e91f96e2ef',
      '0x4f72646572'
    ],
    name: 'ComponentUpdated_Order'
  };

  async processEvent() {
    const { returnValues } = this.eventDoc;

    // check if there is an existing order doc
    const existing = await OrderComponentService.findOne({ ...returnValues });
    const data = (existing) ? {
      ...returnValues,
      initialAmount: existing.amount,
      initialCaller: existing.initialCaller
    } : { ...returnValues };

    const { doc, updated } = await ComponentService.updateOrCreateFromEvent({
      component: 'Order',
      event: this.eventDoc,
      data,
      replace: true
    });

    if (updated) await ElasticSearchService.queueComponentForIndexing({ component: 'Order', id: doc._id });
  }

  static transformEventData(event) {
    const data = event.data.slice(1);
    return {
      crew: this._entityFromUuid(data.shift()), // pathKey
      entity: this._entityFromUuid(data.shift()), // pathKey (exchange)
      orderType: Number(data.shift()), // pathKey
      product: Number(data.shift()), // pathKey
      price: Number(data.shift()), // pathKey
      storage: this._entityFromUuid(data.shift()), // pathKey
      storageSlot: Number(data.shift()), // pathKey
      status: Number(data.shift()),
      amount: Number(data.shift()),
      validTime: Number(data.shift()),
      makerFee: Number(data.shift())
    };
  }
}

module.exports = Handler;
