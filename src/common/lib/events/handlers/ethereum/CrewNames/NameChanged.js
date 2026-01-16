const config = require('config');
const { ActivityService, ComponentService, ElasticSearchService } = require('@common/services');
const Entity = require('@common/lib/Entity');
const BaseHandler = require('../Handler');

class Handler extends BaseHandler {
  static eventName = 'NameChanged';

  static eventFilter = {
    DEPRECATED_AT: config.get('Events.handlers.ethereum.CrewNames.NameChanged.deprecatedAt')
  };

  async processEvent() {
    const { returnValues: { crewId, newName } } = this.eventDoc;
    const entity = Entity.Crewmate(crewId);

    await ComponentService.updateOrCreateFromEvent({
      component: 'Name',
      event: this.eventDoc,
      data: { entity, name: newName }
    });

    await ActivityService.findOrCreateOne({ entities: [entity], event: this.eventDoc });

    await ElasticSearchService.queueEntityForIndexing(entity);
  }
}

module.exports = Handler;
