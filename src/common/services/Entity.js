const mongoose = require('mongoose');
const { castArray, get, isFunction, isObject, omit, pick, set } = require('lodash');
const Entity = require('@common/lib/Entity');
const EntityConfig = require('./Entity/config');
const ComponentService = require('./Components/Component');

class EntityService {
  static formatResult(input, componentConfig) {
    if (!componentConfig?.components) throw new Error('Invalid componentConfig');

    const _result = pick(input, ['id', 'label', 'uuid']);
    return componentConfig.components.reduce((acc, config) => {
      const compName = config.component;

      // format all subdocs for the current component
      const docs = input[compName].map((doc) => {
        let _doc = doc;
        try {
          const _model = ComponentService.model(compName);
          _doc = omit(_model.hydrate(doc).toJSON(), ['entity', 'entities']);
        } catch (error) { /* ignore */ }

        // format any nested/populated data (singular vs array of components)
        (config.components || []).forEach((nestedConfig) => {
          if (!nestedConfig.component || !nestedConfig.as) return;
          if (nestedConfig.isArray) {
            set(_doc, nestedConfig.as, get(doc, nestedConfig.as));
          } else {
            set(_doc, nestedConfig.as, get(doc, nestedConfig.as)[0] || null);
          }
        });

        return _doc;
      });

      if (config.isArray) {
        set(acc, (config.name || compName), docs);
      } else {
        set(acc, (config.name || compName), (docs[0] || null));
      }

      return acc;
    }, _result);
  }

  static async getEntities({ components, id, label, match, uuid, format = false }) {
    // TODO: validate

    const aggregation = [];

    let collection = 'Entity';

    // id(s) match
    if ((id && label) || uuid) {
      // sanitize id/label, convert id(s) and label to array of entities
      const _entities = (id && label) ? castArray(id).map((_id) => Entity.toEntity({ id: _id, label }))
        : [Entity.fromUuid(uuid)];

      // ensure the entity exists in the entities collection
      await Promise.all(_entities.map((e) => mongoose.model('Entity')
        .updateOne({ uuid: e.uuid }, e.toObject(), { upsert: true })));

      // add match query, match on any of the entities by uuid
      aggregation.push({ $match: { $or: _entities.map((e) => ({ uuid: { $eq: e.uuid } })) } });

      // add root entity fields
      aggregation.push({ $addFields: { entity: { id: '$id', label: '$label', uuid: '$uuid' } } });

      aggregation.push({ $project: { _id: 0, __v: 0, entities: 0 } });

    // match on other field
    //  > start aggregation at matching component so minimizing documents looked up,
    //    then rewrite to be virtual-entity-rooted, then populate all components
    } else if (match) {
      // format the $match step
      const collections = new Set();
      const matchQuery = Object.keys(match).reduce((acc, matchKey) => {
        const matchKeyParts = matchKey.split('.');
        collections.add(matchKeyParts.shift());
        acc[matchKeyParts.join('.')] = Array.isArray(match[matchKey]) ? { $in: match[matchKey] } : match[matchKey];
        return acc;
      }, {});
      if (label) matchQuery['entity.label'] = Number(label);

      // only allow component matches on a single component at a time
      // that will be the aggregation's entrypoint
      if (collections.size !== 1) throw new Error('Can only match on one component at a time.');
      const [matchCollection] = collections;

      collection = `${matchCollection}Component`;
      aggregation.push({ $match: matchQuery });

      aggregation.push({
        $replaceRoot: {
          newRoot: {
            id: '$entity.id',
            label: '$entity.label',
            uuid: '$entity.uuid',
            entity: '$entity'
          }
        }
      });

    // match only on label
    } else if (label) {
      aggregation.push({ $match: { label: Number(label) } });
      aggregation.push({ $addFields: { entity: { id: '$id', label: '$label', uuid: '$uuid' } } });
      aggregation.push({ $project: { _id: 0, __v: 0, entities: 0 } });
    } else {
      throw new Error('Unsupported query');
    }

    // limit result set
    // NOTE: this could probably be lower, any consumer pulling this many results
    //  should almost certainly be using elasticsearch instead
    aggregation.push({ $limit: 2500 });

    // attach components
    // TODO: validate
    // NOTE: if undefined, will include all components
    let _label = label;
    if (uuid) _label = Entity.fromUuid(uuid).label;
    const attachComponents = EntityConfig.getByLabel(_label, components);
    attachComponents.components.reduce((acc1, compConfig) => {
      const compName = compConfig.component;
      const pipeline = [{ $project: { _id: 0, __v: 0, entities: 0, event: 0 } }];

      // add additional fiilter(s)
      if (isFunction(compConfig.filter)) {
        pipeline.push(compConfig.filter());
      } else if (isObject(compConfig.filter)) {
        pipeline.push(compConfig.filter);
      }

      // Check for sub components
      if (compConfig.components) {
        acc1.push({ $unwind: { path: `$${compName}`, preserveNullAndEmptyArrays: true } });
        compConfig.components.reduce((pipelineAcc, subComponent) => {
          pipelineAcc.push({
            $lookup: {
              from: `Component_${subComponent.component}`,
              localField: `${subComponent.lf}`,
              foreignField: `${subComponent.ff || 'entity.uuid'}`,
              as: subComponent.as,
              pipeline: [{ $project: { entity: false, event: false, _id: false, __v: false, entities: false } }]
            }
          });
          pipelineAcc.push({ $project: { _id: 0, __v: 0, entities: 0, event: 0 } });
          return pipelineAcc;
        }, pipeline);
      }

      acc1.push({
        $lookup: {
          from: `Component_${compName}`,
          localField: 'entity.uuid',
          foreignField: 'entity.uuid',
          as: compName,
          pipeline
        }
      });

      return acc1;
    }, aggregation);

    const results = await mongoose.model(collection).aggregate(aggregation);
    return (format) ? results.map((r) => this.formatResult(r, attachComponents)) : results;
  }

  static async getEntity({ components, id, label, uuid, ...options }) {
    if ((!id && !label) && !uuid) throw new Error('id/label or uuid required');
    const entity = new Entity({ id, label, uuid });
    const results = await this.getEntities({ components, ...entity, ...options });
    return (results || [])[0];
  }
}

module.exports = EntityService;
