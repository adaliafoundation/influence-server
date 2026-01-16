const { expect } = require('chai');
const mongoose = require('mongoose');
const moment = require('moment');
const Entity = require('@common/lib/Entity');
const { LeaseExpirationNotificationService } = require('@common/services');

describe('LeaseExpirationNotificationService', function () {
  beforeEach(async function () {
    const user = await mongoose.model('User').create({
      address: this.GLOBALS.TEST_STARKNET_WALLET,
      email: 'foo@mail.com'
    });
    await mongoose.model('CrewComponent').create({ entity: Entity.Crew(1), delegatedTo: user.address });
  });

  afterEach(function () {
    return this.utils.resetCollections(['CrewComponent', 'LeaseExpirationNotification', 'User']);
  });

  describe('createOrUpdate', function () {
    it('should create a new notification if one does not exist', async function () {
      const result = await LeaseExpirationNotificationService.createOrUpdate({
        entity: Entity.Building(1),
        endTime: moment().unix() + 1000,
        permission: 1,
        permitted: Entity.Crew(1)
      });

      expect(result.created).to.equal(true);
      expect(result.updated).to.equal(false);
      expect(result.doc).to.be.an('object');
      expect(moment(result.doc.notifyOn).unix())
        .to.equal(result.doc.endTime + LeaseExpirationNotificationService.NOTIFY_BUFFER);
    });

    it('should not create a new notification if the endTime is prior to now', async function () {
      const result = await LeaseExpirationNotificationService.createOrUpdate({
        entity: Entity.Building(1),
        endTime: moment().unix() - 10,
        permission: 1,
        permitted: Entity.Crew(1)
      });
      expect(result.created).to.equal(false);
      expect(result.updated).to.equal(false);
    });

    it('should not create/update if the current endTime matches the specified endTime', async function () {
      const endTime = moment().unix() + 100;
      let result = await LeaseExpirationNotificationService.createOrUpdate({
        entity: Entity.Building(1),
        endTime,
        permission: 1,
        permitted: Entity.Crew(1)
      });
      expect(result.created).to.equal(true);

      result = await LeaseExpirationNotificationService.createOrUpdate({
        entity: Entity.Building(1),
        endTime,
        permission: 1,
        permitted: Entity.Crew(1)
      });
      expect(result.created).to.equal(false);
      expect(result.updated).to.equal(false);
    });

    it('should update the existing notification if the endTime is after the current endTime', async function () {
      const endTime = moment().unix() + 100;
      let result = await LeaseExpirationNotificationService.createOrUpdate({
        entity: Entity.Building(1),
        endTime,
        permission: 1,
        permitted: Entity.Crew(1)
      });
      expect(result.created).to.equal(true);

      const newEndTime = moment().unix() + 200;
      result = await LeaseExpirationNotificationService.createOrUpdate({
        entity: Entity.Building(1),
        endTime: newEndTime,
        permission: 1,
        permitted: Entity.Crew(1)
      });
      expect(result.created).to.equal(false);
      expect(result.updated).to.equal(true);
      expect(result.doc.endTime).to.equal(newEndTime);
    });

    it('should not update the existing notification if the readyAt is before the notifyOn', async function () {
      const endTime = moment().unix() + 200;

      const { doc: notification } = await LeaseExpirationNotificationService.createOrUpdate({
        entity: Entity.Building(1),
        endTime,
        permission: 1,
        permitted: Entity.Crew(1)
      });

      const result = await LeaseExpirationNotificationService.createOrUpdate({
        entity: Entity.Building(1),
        endTime: endTime - 100,
        permission: 1,
        permitted: Entity.Crew(1)
      });
      expect(result.created).to.equal(false);
      expect(result.updated).to.equal(false);
      expect(result.doc.id.toString()).to.equal(notification.id.toString());
    });
  });
});
