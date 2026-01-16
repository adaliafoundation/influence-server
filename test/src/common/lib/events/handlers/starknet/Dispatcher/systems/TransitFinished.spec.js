const { expect } = require('chai');
const mongoose = require('mongoose');
const { Entity: { IDS } } = require('@influenceth/sdk');
const CrewEjectedHandler = require('@common/lib/events/handlers/starknet/Dispatcher/systems/CrewEjected');
const Handler = require('@common/lib/events/handlers/starknet/Dispatcher/systems/TransitFinished');
const ActivityService = require('@common/services/Activity');

describe('TransitFinished Handler', function () {
  let crewEjectedEvent;
  let transitStartedEvent;
  let transitFinishedEvent;

  beforeEach(async function () {
    crewEjectedEvent = mongoose.model('Starknet')({
      data: [
        '0x5', '0x1',
        '0x1', '0x2',
        '0x1',
        '0x1', '0x1',
        '0x123456789'
      ],
      event: 'CrewEjected',
      name: 'CrewEjected',
      logIndex: 1,
      timestamp: 1,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      returnValues: {
        station: { label: 5, id: 1 },
        ejectedCrew: { label: 1, id: 2 },
        finishTime: 1,
        callerCrew: { label: 1, id: 1 },
        caller: '0x0000000000000000000000000000000000000000000000000000000123456789'
      }
    });

    transitStartedEvent = mongoose.model('Starknet')({
      event: 'TransitStarted',
      name: 'TransitStarted',
      data: [
        '0x6', '0x1',
        '0x5', '0x1',
        '0x5', '0x2',
        '0x1',
        '0x2',
        '0x3',
        '0x1', '0x1',
        '0x123456789'
      ],
      logIndex: 1,
      timestamp: 1695691834,
      transactionIndex: 1,
      transactionHash: '0x123456789',
      returnValues: {
        ship: { label: IDS.SHIP, id: 1 },
        origin: { label: IDS.BUILDING, id: 1 },
        destination: { label: IDS.BUILDING, id: 2 },
        departure: 1,
        arrival: 2,
        finishTime: 3,
        callerCrew: { id: 1, label: IDS.CREW },
        caller: '0x0000000000000000000000000000000000000000000000000000000123456789'
      }
    });

    transitFinishedEvent = mongoose.model('Starknet')({
      event: 'TransitFinished',
      data: [
        '0x6', '0x1',
        '0x5', '0x1',
        '0x5', '0x2',
        '0x1',
        '0x2',
        '0x1', '0x1',
        '0x123456789'
      ],
      logIndex: 1,
      timestamp: 1695691835,
      transactionIndex: 1,
      transactionHash: '0x1234567899',
      returnValues: {
        ship: { label: IDS.SHIP, id: 1 },
        origin: { label: IDS.BUILDING, id: 1 },
        destination: { label: IDS.BUILDING, id: 2 },
        departure: 1,
        arrival: 2,
        callerCrew: { id: 1, label: IDS.CREW },
        caller: '0x0000000000000000000000000000000000000000000000000000000123456789'
      }
    });
  });

  afterEach(function () {
    return this.utils.resetCollections(['Activity', 'Entity']);
  });

  describe('hashKeys', function () {
    it('should return the correct hashKeys', function () {
      expect(Handler.hashKeys).to.deep.equal([
        'name',
        'returnValues.ship.id',
        'returnValues.origin.label',
        'returnValues.origin.id',
        'returnValues.destination.label',
        'returnValues.destination.id',
        'returnValues.departure',
        'returnValues.arrival'
      ]);
    });
  });

  describe('processEvent', function () {
    it('should create an Activity Item correctly', async function () {
      await (new Handler(transitFinishedEvent)).processEvent();
      const activityDocs = await mongoose.model('Activity').find({});
      expect(activityDocs).to.have.lengthOf(1);
    });

    it('should resolve the correct Activity Item for transitStartedEvent', async function () {
      const { doc } = await ActivityService.findOrCreateOne({
        addresses: [],
        entities: [],
        event: transitStartedEvent,
        hashKeys: Handler.hashKeys,
        unresolvedFor: [transitStartedEvent.returnValues.callerCrew]
      });

      const handler = new Handler(transitFinishedEvent);
      await handler.processEvent();
      const startActivityDoc = await mongoose.model('Activity').findById(doc._id);

      expect(startActivityDoc.unresolvedFor).to.equal(null);
    });

    it('should resolve the correct Activity Item for crewEjectedEvent', async function () {
      const { doc } = await ActivityService.findOrCreateOne({
        addresses: [],
        entities: [],
        event: crewEjectedEvent,
        hashKeys: CrewEjectedHandler.hashKeys,
        unresolvedFor: [crewEjectedEvent.returnValues.callerCrew, crewEjectedEvent.returnValues.ejectedCrew]
      });
      transitFinishedEvent.returnValues.ship = crewEjectedEvent.returnValues.ejectedCrew;

      const handler = new Handler(transitFinishedEvent);
      await handler.processEvent();
      const startActivityDoc = await mongoose.model('Activity').findById(doc._id);
      expect(startActivityDoc.unresolvedFor).to.equal(null);
    });
  });

  describe('transformEventData', function () {
    it('should transform the data correctly', function () {
      expect(Handler.transformEventData(transitFinishedEvent)).to.deep.equal(transitFinishedEvent.returnValues);
    });
  });
});
