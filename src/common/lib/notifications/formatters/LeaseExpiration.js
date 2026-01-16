const { EntityService } = require('@common/services');
const Entity = require('@common/lib/Entity');
const { asteroidName, entityLink, lotName } = require('./utils');
const NotificationFormatter = require('./Formatter');

class LeaseExpirationNotificationFormatter extends NotificationFormatter {
  async format() {
    const crew = Entity.toEntity(this._notification.permitted);
    const lot = Entity.toEntity(this._notification.entity);
    const { asteroidEntity } = lot.unpackLot();
    const asteroid = await EntityService.getEntity({
      components: ['Celestial', 'Name'],
      uuid: asteroidEntity.uuid,
      format: true
    });

    return {
      body: `Your lease at ${lotName(lot.id)} on ${asteroidName(asteroid)} is expiring in less than 3 days.`,
      crewId: crew.id,
      title: 'Lease Expiring',
      url: entityLink(lot, { query: { crewId: crew.id } })
    };
  }
}

module.exports = LeaseExpirationNotificationFormatter;
