const mongoose = require('mongoose');
const { isEmpty } = require('lodash');
const Entity = require('@common/lib/Entity');
const logger = require('@common/lib/logger');

class ComponentService {
  static modelName(component) {
    return (component.endsWith('Component')) ? component : `${component}Component`;
  }

  static model(component) {
    return mongoose.model(this.modelName(component));
  }

  static async findOne(component, filter, { lean = true } = {}) {
    if (!component) throw new Error('Missing component');
    if (!filter) throw new Error('Missing filter');

    return this.model(component).findOne(filter).lean(lean);
  }

  static findByEntity(component, entity, { filter = {}, lean = true } = {}) {
    const _filter = { ...filter, 'entity.uuid': Entity.toEntity(entity).uuid };
    return this.model(component).find(_filter).lean(lean);
  }

  static findOneByEntity(component, entity, { filter = {}, lean = true } = {}) {
    const _filter = { ...filter, 'entity.uuid': Entity.toEntity(entity).uuid };
    return this.model(component).findOne(_filter).lean(lean);
  }

  static async deleteOne({ component, data, filter, model }) {
    if (!model && !component) throw new Error('Either model or component must be provided');

    const _model = model || mongoose.model(`${component}Component`);
    if (!_model) throw new Error(`Model ${component}Component does not exist`);

    const doc = _model(data);

    if (!doc.uniquePath && !filter) throw new Error('Missing filter or doc.uniquePath()');

    const _filter = filter || doc.uniquePath();
    if (isEmpty(_filter)) throw new Error('Empty filter');

    const { deletedCount } = await _model.deleteOne(_filter);

    return { deletedCount };
  }

  /**
   * This method does a PATCH operation on the component collection.
   * If and only if the timestamp of the current related event is greater than
   * the timestamp of the matched document (or none exists), the document will be updated
   * or created if it does not exist.
   *
   * @param {EventDocument} event
   * @param {String} component
   * @param {Object} filter
   * @param {MongooseModel} model
   * @param {Object} data
   *
   * @returns MongoUpdateResult
   */
  static async updateOrCreateFromEvent({ event, component, filter, model, data, replace = true }) {
    if (!model && !component) throw new Error('Either model or component must be provided');
    if ((!event?._id && !event?.id) || !event?.timestamp) throw new Error('Missing or invalid event');

    const _model = model || mongoose.model(`${component}Component`);
    if (!_model) throw new Error(`Model ${component}Component does not exist`);

    // use specified filter or use the unique path for the component
    const doc = _model({ ...data, event: { id: (event._id || event.id), timestamp: event.timestamp } });

    // validate document since we will not be using the save method to update/create the document
    // this will also set any values as a side effect from running pre-validate middleware
    await doc.validate();

    if (!doc.uniquePath && !filter) throw new Error('Missing filter or doc.uniquePath()');
    const _filter = filter || doc.uniquePath();

    const existing = await _model.findOne(_filter).populate({ path: 'virtuals.event', strictPopulate: false });
    let updated = false;
    let created = false;
    const oldDoc = (existing) ? existing.toObject() : null;

    // test against the populated event
    const existingEvent = existing?.virtuals?.event;

    if (existingEvent) {
      // Only compare the nested event values if the events are from the same chain
      // We are additionally checking the timestamp for the two events. If the incoming event has a later timestamp,
      // no need in checking additional values
      if (event.__t === existingEvent.__t && event.timestamp <= existingEvent.timestamp) {
        // blockNumber comparison
        if (event.blockNumber < existingEvent.blockNumber) return { filter: _filter, doc: existing, updated };

        if (event.blockNumber === existingEvent.blockNumber
          && event.transactionIndex < existingEvent.transactionIndex) {
          return { filter: _filter, doc: existing, updated };
        }

        if (event.blockNumber === existingEvent.blockNumber
          && event.transactionIndex === existingEvent.transactionIndex
          && event.logIndex < existingEvent.logIndex) {
          return { filter: _filter, doc: existing, updated };
        }
      // if different chains, just compare timestamps
      } else if (event.timestamp < existingEvent.timestamp) {
        return { filter: _filter, doc: existing, updated };
      }
    } else if (existing?._id) {
      logger.warn('No associated event found for component:', existing?._id);
    }

    // if we have an existing document and the event is newer, update it
    updated = true;

    if (existing && replace) {
      existing.overwrite({ ...data, event: { id: (event._id || event.id), timestamp: event.timestamp } });
      await existing.save();
    } else if (existing) { // just update with passed in data
      existing.set('event', { id: (event._id || event.id), timestamp: event.timestamp });
      existing.set(data);
      await existing.save();
    } else {
      await doc.save();
      created = true;
    }

    return { created, filter: _filter, doc: (existing || doc), oldDoc, updated };
  }

  static async createOnlyFromEvent({ event, component, filter, model, data }) {
    if (!model && !component) throw new Error('Either model or component must be provided');
    if ((!event?._id && !event?.id) || !event?.timestamp) throw new Error('Missing or invalid event');

    const _model = model || mongoose.model(`${component}Component`);
    if (!_model) throw new Error(`Model ${component}Component does not exist`);

    // use specified filter or use the unique path for the component
    const doc = _model({ ...data, event: { id: (event._id || event.id), timestamp: event.timestamp } });

    // validate document since we will not be using the save method to update/create the document
    // this will also set any values as a side effect from running pre-validate middleware
    await doc.validate();

    if (!doc.uniquePath && !filter) throw new Error('Missing filter or doc.uniquePath()');
    const _filter = filter || doc.uniquePath();

    const { _id, id, ..._data } = doc.toJSON();

    const { upsertedCount: createdCount } = await _model.updateOne(
      _filter,
      { $setOnInsert: _data },
      { upsert: true }
    );

    return { createdCount };
  }
}

module.exports = ComponentService;
