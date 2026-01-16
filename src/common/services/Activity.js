const mongoose = require('mongoose');
const moment = require('moment');
const { compact, get, isEmpty, pick, uniqBy } = require('lodash');
const { num: { isHex } } = require('starknet');
const Entity = require('@common/lib/Entity');
const { md5 } = require('@common/lib/hash');

class ActivityService {
  static async findOrCreateOne({ data, event, addresses = [], entities = [], hashKeys = [], unresolvedFor }) {
    if (!(event instanceof mongoose.model('Event'))) throw new Error('Invalid eventDoc');

    const hash = (hashKeys.length > 0) ? this._getHash(event, hashKeys) : null;

    const eventData = pick(event.toJSON(), [
      'event', 'logIndex', 'name', 'returnValues',
      'timestamp', 'transactionIndex', 'transactionHash', 'version'
    ]);

    const filter = {
      'event.logIndex': eventData.logIndex,
      'event.transactionHash': eventData.transactionHash
    };

    const existing = await mongoose.model('Activity').findOne(filter);

    if (existing) return { doc: existing, created: 0 };
    const doc = await mongoose.model('Activity').create({
      addresses,
      data,
      entities,
      event: eventData,
      hash,
      unresolvedFor
    });

    return { doc, created: 1 };
  }

  static findById(id) {
    return mongoose.model('Activity').findById(id);
  }

  static async find({
    filter,
    lean = false,
    order = 'DESC',
    page = 1,
    pageSize = 100,
    returnTotal = false,
    select = '',
    sort = null,
    hint = null,
    withAnnotations = false
  }) {
    const skip = (page > 0) ? (page - 1) * pageSize : 0;

    const _sort = (!sort) ? {
      'event.timestamp': (order === 'DESC') ? -1 : 1,
      'event.transactionIndex': (order === 'DESC') ? -1 : 1,
      'event.logIndex': (order === 'DESC') ? -1 : 1
    } : sort;

    const query = mongoose.model('Activity')
      .find(filter)
      .skip(skip)
      .limit(pageSize)
      .sort(_sort)
      .select(select)
      .lean(lean);

    if (withAnnotations) query.populate({ path: '_virtuals.eventAnnotations' });

    if (hint) query.hint(hint);

    const [results, totalCount] = await Promise.all([
      query,
      (returnTotal) ? await mongoose.model('Activity').countDocuments(filter) : null
    ]);

    return { docs: results, totalCount };
  }

  static async findForEntity(entity, options = {}) {
    const _entity = Entity.toEntity(entity);
    const filter = { 'entities.uuid': _entity.uuid };
    if (options.eventNames) filter['event.name'] = { $in: options.eventNames };
    if (options.unresolved) filter.isUnresolved = true;
    if (options.since) filter['event.timestamp'] = { $gte: options.since };

    const { docs, totalCount } = await this.find({ filter, ...options });

    // If we need to populate components, get a unique list of entities and query the component data
    // **NOTE** Only the Name component is current needed/supported
    if (options?.components?.includes('Name')) {
      let entities = docs.reduce((acc, doc) => acc.concat(...doc.entities), []);
      entities = uniqBy(entities, 'id');
      const compNameDocs = await mongoose.model('NameComponent')
        .find({ 'entity.uuid': { $in: entities.map((e) => e.uuid) } });

      // add the component data to each entity
      return {
        docs: docs.map((doc) => {
          const _doc = doc.toJSON();
          _doc.entities?.forEach((e) => {
            const compNameDoc = compNameDocs.find((cnd) => cnd.entity.uuid === e.uuid);
            if (compNameDoc) e.Name = { name: compNameDoc.name };
          });
          return _doc;
        }),
        totalCount
      };
    }

    return { docs, totalCount };
  }

  static async findByAddressAndCrew({ address, crewId, ...options }) {
    if (!address) throw new Error('Address required');

    const filter = { $or: [{ $and: [{ addresses: address }, { 'entities.label': { $ne: Entity.IDS.CREW } }] }] };

    if (crewId) filter.$or.push({ 'entities.uuid': Entity.Crew(crewId).uuid });

    if (options.since) filter['event.timestamp'] = { $gte: options.since };
    if (options.txHash) filter['event.transactionHash'] = { $in: options.txHash };
    if (options.types) filter['event.event'] = { $in: options.types };

    const { docs, totalCount } = await this.find({ filter, ...options });

    return { docs, totalCount };
  }

  static async findStartActivity(startEventName, eventDoc, keys) {
    if (!startEventName) throw new Error('startEventName required');
    if (!eventDoc) throw new Error('eventDoc required');
    if (!keys || keys.length === 0) throw new Error('keys required');

    const hash = this._getHash(eventDoc, keys, startEventName);

    const activityDoc = await mongoose.model('Activity').findOne({
      hash,
      'event.timestamp': { $lte: eventDoc.timestamp }
    })
      .populate('_virtuals.event')
      .sort({ 'event.timestamp': -1 });

    if (!activityDoc) return null;

    // attempt to use the populate event first becauase it will have the most accurate data
    const startEventDoc = (activityDoc._virtuals?.event) ? (activityDoc._virtuals?.event) : activityDoc.event;

    // Need to make sure the found doc's event is before the specified "end" event
    if (startEventDoc.timestamp < eventDoc.timestamp) return activityDoc;
    if (startEventDoc.timestamp === eventDoc.timestamp
      && startEventDoc.transactionIndex < eventDoc.transactionIndex) return activityDoc;
    if (startEventDoc.timestamp === eventDoc.timestamp
        && startEventDoc.transactionIndex === eventDoc.transactionIndex
        && startEventDoc.logIndex < eventDoc.logIndex) return activityDoc;

    return null;
  }

  static findUnresolvedForCrew(crewId) {
    if (!Number(crewId)) throw new Error('Invalid crewId');

    return mongoose.model('Activity')
      .find({ 'unresolvedFor.uuid': Entity.Crew(crewId).uuid })
      .limit(1000)
      .lean();
  }

  static hideFrom({ id, address }) {
    return mongoose.model('Activity').updateOne({ _id: id }, { $push: { hiddenBy: address } });
  }

  static findOngoing({ asteroid, ...props }) {
    if (!asteroid) throw new Error('asteroid param required');

    const eventNames = [
      'BuyOrderCreated',
      'ConstructionPlanned',
      'ConstructionStarted',
      'ConstructionDeconstructed',
      'CrewEjected',
      'CrewStationed',
      'MaterialProcessingStarted',
      'ResourceExtractionStarted',
      'SamplingDepositStarted',
      'SellOrderCreated',
      'ShipAssemblyStarted',
      'ShipDocked',
      'ShipUndocked'
    ];

    let asteroidEntity;
    if (isHex(asteroid)) {
      asteroidEntity = Entity.toEntity({ uuid: asteroid });
    } else if (Object.isObject(asteroid)) {
      asteroidEntity = Entity.toEntity(asteroid);
    } else {
      asteroidEntity = Entity.Asteroid(asteroid);
    }
    const now = moment().unix();

    return this.find({
      lean: true,
      returnTotal: false,
      ...props,
      filter: {
        'event.name': { $in: eventNames },
        'data.crew.Crew.readyAt': { $gt: now },
        'data.crew.Crew.lastReadyAt': { $lt: now },
        'data.crew.Location.locations.uuid': asteroidEntity.uuid,
        'event.timestamp': { $lt: now }
      },
      sort: {}
    });
  }

  /**
   * Remove all activities matching the transactionHash for event docs that have been marked as removed
   */
  static async purgeByRemoved() {
    const eventDocs = await mongoose.model('Event')
      .find({ removed: true })
      .select('transactionHash');

    if (eventDocs.length > 0) {
      await mongoose.model('Activity').deleteMany({
        'event.transactionHash': { $in: eventDocs.map(({ transactionHash }) => transactionHash) } });
    }
  }

  /**
   * Clear the unresolvedFor field the start activity
   * Only resolve if the event on the activity happened before the eventDoc
   *
   * @param {String} startEventName
   * @param {Object} eventDoc
   * @param {Array<String>} keys
   * @returns {Object}
   */
  static async resolveStartActivity(startEventName, eventDoc, keys) {
    const activityDoc = await this.findStartActivity(startEventName, eventDoc, keys);
    if (!activityDoc) return { status: 'NOT_FOUND', doc: null };
    if (activityDoc.unresolvedFor && activityDoc.unresolvedFor.length > 0) {
      activityDoc.set('unresolvedFor', null);
      activityDoc.set('isUnresolved', null);
      await activityDoc.save();
      return { status: 'RESOLVED', doc: activityDoc };
    }
    return { status: 'ALREADY_RESOLVED', doc: activityDoc };
  }

  static updateUnresolvedFor(unresolvedFor, filter, hint = null) {
    if (!unresolvedFor) throw new Error('unresolvedFor required');
    if (isEmpty(filter)) throw new Error('filter required');

    const _unresolvedFor = new Entity(unresolvedFor);
    const query = mongoose.model('Activity').updateMany(filter, {
      unresolvedFor: [_unresolvedFor], isUnresolved: true
    });
    if (hint) query.hint(hint);
    return query;
  }

  static updateDeliveryPackagedUnresolvedFor(callerCrew, building) {
    if (!callerCrew) throw new Error('callerCrew required');
    if (!building?.id) throw new Error('building required');

    return this.updateUnresolvedFor(callerCrew, {
      'event.name': 'DeliveryPackaged',
      'event.returnValues.dest.id': building.id,
      isUnresolved: true
    }, 'DeliveryPackaged_unresolved');
  }

  /**
   * Create a hash from the specified keys of the eventDoc
   * If the eventName is specified, the event.event property will be set to that value
   *
   * @param {Object} eventDoc
   * @param {Array<String>} keys
   * @param {String} eventName (Optional)
   * @returns String
   */
  static _getHash(eventDoc, keys, eventName) {
    const eventData = (eventDoc.toJSON) ? eventDoc.toJSON() : { ...eventDoc };
    if (eventName) eventData.name = eventName;
    return md5(`${compact((keys.map((key) => get(eventData, key)))).join('')}`);
  }
}

module.exports = ActivityService;
