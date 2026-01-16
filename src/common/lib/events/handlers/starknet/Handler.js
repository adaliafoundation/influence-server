const { num: { toHex } } = require('starknet');
const Entity = require('@common/lib/Entity');
const BaseHandler = require('../BaseHandler');

class StarknetBaseHandler extends BaseHandler {
  /**
   * @description Takes an Event object formatted from the Starknet provider and add the
   * formatted event name, parsed return values and event version.
   *
   * @param {Object} event
   * @returns Object
   */
  static parseEvent(event) {
    return {
      ...event,
      event: this.eventName, // add the readable event name (derived from keys)
      name: this.baseName,
      returnValues: this.transformEventData(event),
      version: this.eventVersion
    };
  }

  /**
   * Returns the UN-versioned or root portion of the event name.
   */
  static get baseName() {
    if (!this.eventConfig?.baseName && !this.eventConfig?.name) throw new Error('Must implement in sub class');
    return this.eventConfig.baseName || this.eventConfig.name;
  }

  /**
   * Returns the non-encoded event name
   * @example 'SomeEventNameV1' => 'SomeEventNameV1'
   */
  static get eventName() {
    if (!this.eventConfig?.name) throw new Error('Must implement in sub class');
    return this.eventConfig.name;
  }

  static get eventVersion() {
    return this.eventConfig?.version || 0;
  }

  /**
   * @description Combines a keccak256 the first eventKey and
   *  standardized hex for the second value (if present) value via a '_'.
   * @example ['ComponentUpdated', 'Name'] =>
   *  0x297be67eb977068ccd2304c6440368d4a6114929aeb860c98b6a7e91f96e2ef_0x4e616d65
   *
   * @returns String
   */
  static get eventNameKey() {
    if (!this.eventConfig?.keys || this.eventConfig.keys.length === 0) throw new Error('Must implement in sub class');
    return this.eventConfig.keys.map(toHex).join('_');
  }

  static transformEventData() {
    throw new Error('Must implement in sub class');
  }

  static _entityFromData(data) {
    const entity = { label: Number(data.shift()), id: Number(data.shift()) };
    return (entity.label === 0 || entity.id === 0) ? null : entity;
  }

  static _entityFromUuid(data) {
    const entity = Entity.fromUuid(data);
    return { label: entity.label, id: entity.id };
  }
}

module.exports = StarknetBaseHandler;
