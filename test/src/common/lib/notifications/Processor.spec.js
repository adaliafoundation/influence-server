const { expect } = require('chai');
const mongoose = require('mongoose');
const moment = require('moment');
const Entity = require('@common/lib/Entity');
const NotificationsProcessor = require('@common/lib/notifications/Processor');
const NotificationConfig = require('@common/lib/notifications/config');

describe('NotificationsProcessor', function () {
  afterEach(function () {
    return this.utils.resetCollections(['Entity', 'LocationComponent', 'NameComponent', 'Notification']);
  });

  describe('_formatSubject', function () {
    it('should return the correctly formatted subject', async function () {
      const crewEntity = Entity.Crew(1);
      await Promise.all([
        mongoose.model('Entity').create(crewEntity),
        mongoose.model('NameComponent').create({ entity: crewEntity, name: 'Crew 1' }),
        mongoose.model('LocationComponent').create({ entity: crewEntity, location: Entity.Asteroid(1) })
      ]);

      const now = moment();
      const notifications = await Promise.all([
        mongoose.model('CrewReadyNotification').create({
          crew: crewEntity,
          readyAt: now.unix(),
          recipients: [crewEntity],
          notifyOn: now.toISOString()
        }),
        mongoose.model('LeaseExpirationNotification').create({
          entity: Entity.lotFromIndex(1, 1),
          endTime: now.unix(),
          permission: 1,
          permitted: crewEntity,
          recipients: [crewEntity],
          notifyOn: now.toISOString()
        })
      ]);

      const formatted = await Promise.all((notifications).map(async function (doc) {
        const { formatter: Formatter } = NotificationConfig.getByDocument(doc);
        const result = await (new Formatter({ notification: doc })).format();
        return result;
      }));

      const processor = new NotificationsProcessor();
      const result = processor._formatSubject(formatted);
      expect(result).to.equal('Crew Ready (+1 more)');
    });
  });
});
