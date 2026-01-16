const { Address } = require('@influenceth/sdk');
const Entity = require('@common/lib/Entity');
const { ActivityService } = require('@common/services');
const CrewEjectedHandler = require('./CrewEjected');
const StarknetBaseHandler = require('../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x102fd7c0ddcb8814a0e6822fd9e408114ea8792462f5d2a5adb91bc26993442'],
    name: 'TransitFinished'
  };

  static hashKeys = [
    'name',
    'returnValues.ship.id',
    'returnValues.origin.label',
    'returnValues.origin.id',
    'returnValues.destination.label',
    'returnValues.destination.id',
    'returnValues.departure',
    'returnValues.arrival'
  ];

  async processEvent() {
    const { returnValues: { callerCrew, caller, destination, origin, ship } } = this.eventDoc;

    const activityResult = await ActivityService.findOrCreateOne({
      addresses: [caller],
      entities: [callerCrew, destination, origin, ship],
      event: this.eventDoc
    });

    if (activityResult?.created === 0) return;

    // if this is an escape module, we need to attemp to resolved the CrewEjected event
    if (Entity.isCrew(ship)) {
      await ActivityService.resolveStartActivity(
        'CrewEjected',
        {
          ...this.eventDoc.toJSON(),
          returnValues: { ejectedCrew: ship }
        },
        CrewEjectedHandler.hashKeys
      );
    }

    await ActivityService.resolveStartActivity('TransitStarted', this.eventDoc, Handler.hashKeys);
    this.messages.push({ to: `Crew::${callerCrew.id}` });
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      ship: this._entityFromData(data),
      origin: this._entityFromData(data),
      destination: this._entityFromData(data),
      departure: Number(data.shift()),
      arrival: Number(data.shift()),
      callerCrew: this._entityFromData(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
