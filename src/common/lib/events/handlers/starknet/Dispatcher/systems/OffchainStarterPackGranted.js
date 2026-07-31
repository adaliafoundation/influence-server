const mongoose = require('mongoose');
const { Address } = require('@influenceth/sdk');
const Entity = require('@common/lib/Entity');
const {
  ActivityService,
  ComponentService,
  ElasticSearchService
} = require('@common/services');
const StarknetBaseHandler = require('../../Handler');

class Handler extends StarknetBaseHandler {
  static eventConfig = {
    keys: ['0x02caa80462b4e5f4db153f3f30fb89b9261ffbef7f22967cc29bd0f778280103'],
    name: 'OffchainStarterPackGranted'
  };

  async processEvent() {
    const {
      caller,
      composition,
      crew,
      externalRef,
      productId,
      recipient,
      restrictedUntil
    } = this.eventDoc.returnValues;

    const crewmateEntities = composition.map((crewmateId) => Entity.Crewmate(crewmateId).toObject());

    await Promise.all(crewmateEntities.map((entity) => ComponentService.updateOrCreateFromEvent({
      component: 'StarterPackCrewmate',
      event: this.eventDoc,
      data: { entity, crew, productId, restrictedUntil },
      replace: true
    })));

    await ActivityService.findOrCreateOne({
      addresses: [recipient, caller],
      entities: [crew, ...crewmateEntities],
      event: this.eventDoc
    });

    await mongoose.model('StarterPackPurchase').updateOne(
      { externalRef },
      {
        $set: {
          grantedAt: new Date(this.eventDoc.timestamp * 1000),
          grantedCrew: crew,
          status: 'granted'
        }
      }
    );

    await Promise.all([
      ElasticSearchService.queueEntityForIndexing(crew),
      ElasticSearchService.queueEntitiesForIndexing({ entities: crewmateEntities })
    ]);

    this.messages.push({ to: recipient, body: { entities: [crew, ...crewmateEntities] } });
    this.messages.push({ to: `Crew::${crew.id}`, body: { entities: [crew, ...crewmateEntities] } });
  }

  static transformEventData(event) {
    const data = [...event.data];
    const compositionLength = Number(data.splice(5, 1)[0]);
    const composition = data.splice(5, compositionLength).map(Number);

    return {
      externalRef: data.shift(),
      productId: Number(data.shift()),
      recipient: Address.toStandard(data.shift(), 'starknet'),
      crew: this._entityFromData(data),
      composition,
      restrictedUntil: Number(data.shift()),
      lotAllowance: Number(data.shift()),
      foodReloadAllowance: Number(data.shift()),
      coreSampleAllowance: Number(data.shift()),
      caller: Address.toStandard(data.shift(), 'starknet')
    };
  }
}

module.exports = Handler;
