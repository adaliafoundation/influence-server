const { chain } = require('lodash');
const BaseHandler = require('../BaseHandler');

class Handler extends BaseHandler {
  /**
   * @description Formats an event object
   *
   * @param {Object} event
   * @returns Object
  */
  static parseEvent(event) {
    return {
      ...event,
      returnValues: this.transformEventData(event)
    };
  }

  /**
   * Format the `returnValues` of an event object.
   * For legacy/consistency purposes, we remove the __length__ key and convert all values to strings.
   *
   * @param {EventObject} event
   * @returns Object
   */
  static transformEventData(event) {
    return chain(event.returnValues)
      .omit('__length__')
      .reduce((acc, val, key) => {
        acc[key] = (Array.isArray(val)) ? val.map((v) => v.toString()) : val.toString();
        return acc;
      }, {})
      .value();
  }
}

module.exports = Handler;
