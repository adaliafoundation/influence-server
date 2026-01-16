const mongoose = require('mongoose');
const { isFunction } = require('lodash');
const Entity = require('@common/lib/Entity');
const ComponentService = require('@common/services/Components/Component');

const ENTITY_QUEUE_PRIORITY = 10;
const COMPONENT_QUEUE_PRIORITY = 10;

class ElasticSearchService {
  static async queueComponentForIndexing({ component, id, priority = COMPONENT_QUEUE_PRIORITY }) {
    const model = ComponentService.modelName(component);
    const identifier = { _id: id };

    return this.queueForIndexing({ identifier, model, priority });
  }

  static async queueComponentsForIndexing({ docs, component, cursor, priority = COMPONENT_QUEUE_PRIORITY }) {
    if (!component) throw new Error('Component is required');

    const model = ComponentService.modelName(component);
    if (!model) throw new Error(`Invalid component: ${component}`);

    const flush = async (_docs) => {
      const actions = _docs.reduce((acc, doc) => {
        acc.push({ insertOne: { document: { model, identifier: { _id: (doc.id || doc._id) }, priority } } });
        return acc;
      }, []);

      return mongoose.model('IndexItem').bulkWrite(actions);
    };

    if (cursor) {
      let _docs = [];
      for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
        if (_docs.length === 1000) {
          await flush(_docs);
          _docs = [];
        }

        _docs.push({ _id: doc._id });
      }

      // clear out any remaining entities
      if (_docs.length > 0) await flush(_docs);
    } else {
      await flush(docs);
    }
  }

  static async queueEntityForIndexing(entity, priority = ENTITY_QUEUE_PRIORITY) {
    const _entity = Entity.toEntity(entity);
    const identifier = { uuid: _entity.uuid };
    return this.queueForIndexing({ identifier, model: 'Entity', priority });
  }

  static async queueEntitiesForIndexing({ entities, cursor, getEntityFromDoc, priority = ENTITY_QUEUE_PRIORITY }) {
    const flush = async (_entites) => {
      const actions = _entites.reduce((acc, entity) => {
        const _entity = Entity.toEntity(entity);
        acc.push({ insertOne: { document: { model: 'Entity', identifier: { uuid: _entity.uuid }, priority } } });
        return acc;
      }, []);

      return mongoose.model('IndexItem').bulkWrite(actions);
    };

    if (cursor) {
      let _entities = [];
      for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
        if (_entities.length === 1000) {
          await flush(_entities);
          _entities = [];
        }

        // attempt to determine the entity to be indexed
        const entity = (isFunction(getEntityFromDoc)) ? getEntityFromDoc(doc) : doc.entity;
        if (!entity || !entity.uuid) throw new Error('Unable to determine entity');
        _entities.push(entity);
      }

      // clear out any remaining entities
      if (_entities.length > 0) await flush(_entities);
    } else {
      await flush(entities);
    }
  }

  static async queueForIndexing({ identifier, model, priority = 0 }) {
    await mongoose.model('IndexItem').create({ identifier, model, priority });
  }

  /**
   * Queue related items for indexing
   *
   * @param {Object} entity
   * @returns {Promise<void>}
   */
  static async queueRelatedEntitiesForIndexing(entity, priority = ENTITY_QUEUE_PRIORITY) {
    const _entity = Entity.toEntity(entity);
    let cursor;
    if (_entity.isAsteroid()) {
      cursor = mongoose.model('LocationComponent').find({
        'entity.label': { $in: [Entity.IDS.BUILDING, Entity.IDS.CREW, Entity.IDS.DEPOSIT, Entity.IDS.SHIP] },
        'locations.uuid': _entity.uuid
      }).cursor();

      return this.queueEntitiesForIndexing({ cursor, priority });
    }
    if (_entity.isBuilding()) {
      cursor = mongoose.model('LocationComponent').find({
        'entity.label': { $in: [Entity.IDS.CREW, Entity.IDS.SHIP] },
        'locations.uuid': _entity.uuid
      }).cursor();

      return this.queueEntitiesForIndexing({ cursor, priority });
    }
    if (_entity.isCrew()) {
      cursor = mongoose.model('ControlComponent').find({
        'entity.label': { $in: [Entity.IDS.BUILDING, Entity.IDS.CREWMATE, Entity.IDS.DEPOSIT, Entity.IDS.SHIP] },
        'controller.uuid': _entity.uuid
      }).cursor();

      return this.queueEntitiesForIndexing({ cursor, priority });
    }
    if (_entity.isCrewmate()) {
      cursor = mongoose.model('CrewComponent').find({ roster: entity.id }).cursor();

      return this.queueEntitiesForIndexing({ cursor, priority });
    }
    if (_entity.isShip()) {
      cursor = mongoose.model('LocationComponent').find({
        'entity.label': { $in: [Entity.IDS.CREWMATE] },
        'locations.uuid': _entity.uuid
      }).cursor();

      return this.queueEntitiesForIndexing({ cursor, priority });
    }

    return null;
  }
}

module.exports = ElasticSearchService;
