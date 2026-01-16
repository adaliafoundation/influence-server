const { EntityService } = require('@common/services');
const { crewName, entityLink } = require('./utils');
const NotificationFormatter = require('./Formatter');

class CrewReadyNotificationFormatter extends NotificationFormatter {
  async format() {
    const crewEntity = await EntityService.getEntity({
      components: ['Location', 'Name'],
      uuid: this._notification.crew.uuid,
      format: true
    });

    return {
      body: `${crewName(crewEntity)} has reached their station and is ready for their next task.`,
      crewId: crewEntity.id,
      title: 'Crew Ready',
      url: entityLink(crewEntity?.Location?.location, { query: { crewId: crewEntity.id } })
    };
  }
}

module.exports = CrewReadyNotificationFormatter;
