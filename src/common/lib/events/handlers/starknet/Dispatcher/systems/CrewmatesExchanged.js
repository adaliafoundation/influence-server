const { differenceBy } = require('lodash');
const { Address, Entity } = require('@influenceth/sdk');
const { ActivityService } = require('@common/services');
const StarknetBaseHandler = require('../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x11179a9c5e4311bfde19c5306ff4358bf284a55d5069e8187cb6129c9b47a2a'],
    name: 'CrewmatesExchanged'
  };

  static unpackEntities(data) {
    const length = data.shift();
    const entities = [];
    for (let i = 0; i < length; i += 1) {
      entities.push({ id: Number(data.shift()), label: Entity.IDS.CREWMATE });
    }

    return entities;
  }

  async processEvent() {
    const {
      returnValues: {
        crew1,
        crew2,
        crew1CompositionOld,
        crew1CompositionNew,
        crew2CompositionOld,
        crew2CompositionNew,
        caller
      }
    } = this.eventDoc;

    const crewmates = [
      ...differenceBy(crew1CompositionNew, crew1CompositionOld, 'id'),
      ...differenceBy(crew2CompositionNew, crew2CompositionOld, 'id')
    ];

    const activityResult = await ActivityService.findOrCreateOne({
      addresses: [caller],
      entities: [crew1, crew2, ...crewmates],
      event: this.eventDoc
    });

    if (activityResult?.created === 0) return;

    this.messages.push({ to: `Crew::${crew1.id}` });
    this.messages.push({ to: `Crew::${crew2.id}` });

    // push a message to the caller room
    this.messages.push({ to: caller });
  }

  static transformEventData(event) {
    const data = [...event.data];
    return {
      crew1: this._entityFromData(data),
      crew1CompositionOld: this.unpackEntities(data),
      crew1CompositionNew: this.unpackEntities(data),
      crew2: this._entityFromData(data),
      crew2CompositionOld: this.unpackEntities(data),
      crew2CompositionNew: this.unpackEntities(data),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
