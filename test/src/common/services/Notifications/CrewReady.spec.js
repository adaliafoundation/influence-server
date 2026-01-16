const { expect } = require('chai');
const mongoose = require('mongoose');
const moment = require('moment');
const Entity = require('@common/lib/Entity');
const { CrewReadyNotificationService } = require('@common/services');

describe('CrewReadyNotificationService', function () {
  beforeEach(async function () {
    const user = await mongoose.model('User').create({
      address: this.GLOBALS.TEST_STARKNET_WALLET,
      email: 'foo@mail.com'
    });
    await mongoose.model('CrewComponent').create({ entity: Entity.Crew(1), delegatedTo: user.address });
  });

  afterEach(function () {
    return this.utils.resetCollections(['CrewComponent', 'CrewReadyNotification', 'User']);
  });

  describe('createOrUpdate', function () {
    it('should create a new notification if one does not exist', async function () {
      const result = await CrewReadyNotificationService.createOrUpdate({
        crew: Entity.Crew(1), readyAt: (moment().unix() + 10)
      });
      expect(result.created).to.equal(true);
      expect(result.updated).to.equal(false);
      expect(result.doc).to.be.an('object');
    });

    it('should not create a new notification if the readyAt is prior to now', async function () {
      const result = await CrewReadyNotificationService.createOrUpdate({
        crew: Entity.Crew(1), readyAt: (moment().unix() - 1)
      });
      expect(result.created).to.equal(false);
      expect(result.updated).to.equal(false);
    });

    it('should not create/update if the current readyAt matches the specified readyAt', async function () {
      const readyAt = moment().unix() + 100;
      const crew = Entity.Crew(1);
      let result = await CrewReadyNotificationService.createOrUpdate({ crew, readyAt });
      expect(result.created).to.equal(true);

      result = await CrewReadyNotificationService.createOrUpdate({ crew, readyAt });
      expect(result.created).to.equal(false);
      expect(result.updated).to.equal(false);
    });

    it('should update the existing notification if the readyAt is after the current readyAt', async function () {
      const readyAt = moment().unix() + 100;
      const crew = Entity.Crew(1);
      let result = await CrewReadyNotificationService.createOrUpdate({ crew, readyAt });
      expect(result.created).to.equal(true);

      const newReadyAt = moment().unix() + 200;
      result = await CrewReadyNotificationService.createOrUpdate({ crew, readyAt: newReadyAt });
      expect(result.created).to.equal(false);
      expect(result.updated).to.equal(true);
      expect(result.doc.readyAt).to.equal(newReadyAt);
    });

    it('should not update the existing notification if the readyAt is before the notifyOn', async function () {
      const readyAt = moment().unix() + 200;
      const crew = Entity.Crew(1);
      const { doc: notification } = await CrewReadyNotificationService.createOrUpdate({ crew, readyAt });

      const result = await CrewReadyNotificationService.createOrUpdate({ crew, readyAt: readyAt - 100 });
      expect(result.created).to.equal(false);
      expect(result.updated).to.equal(false);
      expect(result.doc.id.toString()).to.equal(notification.id.toString());
    });
  });
});
