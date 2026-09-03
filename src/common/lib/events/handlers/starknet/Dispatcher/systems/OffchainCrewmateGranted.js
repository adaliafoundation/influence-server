const { pullAt, range } = require('lodash');
const mongoose = require('mongoose');
const { shortString } = require('starknet');
const { Address } = require('@influenceth/sdk');
const { ActivityService, ElasticSearchService } = require('@common/services');
const StarknetBaseHandler = require('../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x409afd32d904627ff7baa2425536f3848bced1d0a730608492e71679e2c38a'],
    name: 'OffchainCrewmateGranted'
  };

  async processEvent() {
    const {
      caller,
      callerCrew,
      crewmate,
      externalRef,
      recipient,
      station
    } = this.eventDoc.returnValues;

    await ActivityService.findOrCreateOne({
      addresses: [recipient, caller],
      entities: [crewmate, callerCrew, station],
      event: this.eventDoc
    });

    await mongoose.model('CrewmatePurchase').updateOne(
      { externalRef },
      {
        $set: {
          grantedAt: new Date(this.eventDoc.timestamp * 1000),
          grantedCrew: callerCrew,
          grantedCrewmate: crewmate,
          status: 'grant_confirmed'
        }
      }
    );

    await Promise.all([
      ElasticSearchService.queueEntityForIndexing(callerCrew),
      ElasticSearchService.queueEntityForIndexing(crewmate)
    ]);

    this.messages.push({ to: recipient, body: { entities: [callerCrew, crewmate] } });
    this.messages.push({ to: `Crew::${callerCrew.id}`, body: { entities: [callerCrew, crewmate] } });
  }

  static transformEventData(event) {
    const data = [...event.data];
    const externalRef = data.shift();
    const recipient = Address.toStandard(data.shift(), 'starknet');
    const crewmate = this._entityFromData(data);
    const collection = Number(data.shift());
    const crewmateClass = Number(data.shift());
    const title = Number(data.shift());
    const impactful = pullAt(data, range(0, Number(data.shift()))).map(Number);
    const cosmetic = pullAt(data, range(0, Number(data.shift()))).map(Number);
    const gender = Number(data.shift());
    const body = Number(data.shift());
    const face = Number(data.shift());
    const hair = Number(data.shift());
    const hairColor = Number(data.shift());
    const clothes = Number(data.shift());
    const head = Number(data.shift());
    const item = Number(data.shift());
    const name = shortString.decodeShortString(data.shift());
    const station = this._entityFromData(data);
    const composition = pullAt(data, range(0, Number(data.shift()))).map(Number);
    const callerCrew = this._entityFromData(data);
    const restrictedUntil = Number(data.shift());
    const caller = Address.toStandard(data.shift(), 'starknet');

    return {
      externalRef,
      recipient,
      crewmate,
      collection,
      class: crewmateClass,
      title,
      impactful,
      cosmetic,
      gender,
      body,
      face,
      hair,
      hairColor,
      clothes,
      head,
      item,
      name,
      station,
      composition,
      callerCrew,
      restrictedUntil,
      caller
    };
  }
}

module.exports = Handler;
