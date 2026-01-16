const { pullAt } = require('lodash');

const { ComponentService, ElasticSearchService } = require('@common/services');
const { Fixed } = require('../../utils');
const BaseHandler = require('../../Handler');

class Handler extends BaseHandler {
  static eventConfig = {
    keys: [
      '0x297be67eb977068ccd2304c6440368d4a6114929aeb860c98b6a7e91f96e2ef',
      '0x4f72626974'
    ],
    name: 'ComponentUpdated_Orbit'
  };

  async processEvent() {
    const { returnValues: { entity } } = this.eventDoc;

    const { updated } = await ComponentService.updateOrCreateFromEvent({
      component: 'Orbit',
      event: this.eventDoc,
      data: { ...this.eventDoc.returnValues },
      replace: true
    });

    if (updated) await ElasticSearchService.queueEntityForIndexing(entity);
  }

  static transformEventData(event) {
    const data = event.data.slice(1);
    return {
      entity: this._entityFromUuid(data.shift()),
      a: Fixed.toFixed(pullAt(data, 0, 1), 128).valueOf(), // semi-major axis
      ecc: Fixed.toFixed(pullAt(data, 0, 1), 128).valueOf(), // eccentricity
      inc: Fixed.toFixed(pullAt(data, 0, 1), 128).valueOf(), // inclination
      raan: Fixed.toFixed(pullAt(data, 0, 1), 128).valueOf(), // right ascension of the ascending node
      argp: Fixed.toFixed(pullAt(data, 0, 1), 128).valueOf(), // argument of periapsis
      m: Fixed.toFixed(pullAt(data, 0, 1), 128).valueOf() // mean anomaly
    };
  }
}

module.exports = Handler;
