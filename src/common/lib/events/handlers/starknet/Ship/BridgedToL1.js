const Entity = require('@common/lib/Entity');
const BaseHandler = require('../common/BridgedToL1');

class Handler extends BaseHandler {
  static eventConfig = {
    keys: ['0x343404fbb463bc14499440cae988896483e039778a9ed66bfaf125d4bc364cc'],
    name: 'BridgedToL1'
  };

  async processEvent() {
    const { returnValues: { tokenId } } = this.eventDoc;
    const entity = Entity.Ship(tokenId);

    await super.processEvent(entity);
    this.messages.push({ to: `Ship::${entity.id}` });
  }
}

module.exports = Handler;
