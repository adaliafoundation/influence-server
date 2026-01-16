const mongoose = require('mongoose');
const moment = require('moment');
const { flatten } = require('lodash');
const { Permission } = require('@influenceth/sdk');
const Entity = require('@common/lib/Entity');
const ComponentService = require('./Components/Component');

class LotService {
  static async getLeaseStatus(lotEntity) {
    const hasAgreement = await this.hasLeaseAgreement(lotEntity);
    if (hasAgreement) return 2;

    const hasPolicy = await this.hasLeasePolicy(lotEntity);

    // we can bail out early if there is no policy
    if (!hasPolicy) return 0;

    // check for a building controlled by the asteroid controller
    const hasAsteroidControlledBuilding = await this.hasBuildingControlledByAsteroidController(lotEntity);

    // has an active policy and no building controlled by the asteroid controller
    if (hasPolicy && !hasAsteroidControlledBuilding) return 1;

    return 0;
  }

  static async hasBuildingControlledByAsteroidController(lotEntity) {
    const { asteroidEntity } = Entity.toEntity(lotEntity).unpackLot();

    const asteroidControllerDoc = await mongoose.model('ControlComponent')
      .findOne({ 'entity.uuid': asteroidEntity.uuid });
    if (!asteroidControllerDoc) return false;

    // sanitize the specified lot entity
    const _lotEntity = Entity.toEntity(lotEntity);
    if (!_lotEntity.isLot()) throw new Error('Invalid lot entity');

    const result = await mongoose.model('LocationComponent').aggregate([
      // check for buildings on the specified lot
      { $match: { 'location.uuid': _lotEntity.uuid, 'entity.label': 5 } },

      // get the matching building component
      {
        $lookup: {
          from: 'Component_Building',
          localField: 'entity.uuid',
          foreignField: 'entity.uuid',
          as: 'Buliding'
        }
      },

      // building status must be greater than 0
      { $match: { 'Buliding.status': { $gt: 0 } } },

      // lookup the controllers for the building(s)
      {
        $lookup: {
          from: 'Component_Control',
          localField: 'entity.uuid',
          foreignField: 'entity.uuid',
          as: 'Control'
        }
      },

      // filter for buildings controlled by the asteroid controller
      { $match: { 'Control.controller.uuid': asteroidControllerDoc.controller.uuid } }
    ]);

    return (result.length > 0);
  }

  static async hasLeaseAgreement(lotEntity) {
    if (lotEntity.label !== Entity.IDS.LOT) throw new Error('Invalid lot entity');
    const _lotEntity = Entity.toEntity(lotEntity);

    const [hasPrepaidAgreement, contractAgreement] = await Promise.all([
      mongoose.model('PrepaidAgreementComponent').exists({
        'entity.uuid': _lotEntity.uuid,
        permission: Permission.IDS.USE_LOT,
        endTime: { $gt: moment().unix() }
      }),
      mongoose.model('ContractAgreementComponent').findOne({
        'entity.uuid': _lotEntity.uuid,
        permission: Permission.IDS.USE_LOT
      })
    ]);

    return hasPrepaidAgreement || contractAgreement;
  }

  static async hasLeasePolicy(lotEntity) {
    const _lotEntity = Entity.toEntity(lotEntity);
    if (!_lotEntity.isLot()) throw new Error('Invalid lot entity');

    const { asteroidEntity, lotIndex } = _lotEntity.unpackLot();
    const [hasPrepaidMerklePolicy, hasContractPolicy, hasPrepaidPolicy, hasPublicPolicy] = await Promise.all([
      mongoose.model('PrepaidMerklePolicyComponent').exists({
        lotIndices: { $in: [lotIndex] },
        permission: Permission.IDS.USE_LOT
      }),
      mongoose.model('ContractPolicyComponent').exists({
        'entity.uuid': asteroidEntity.uuid,
        permission: Permission.IDS.USE_LOT
      }),
      mongoose.model('PrepaidPolicyComponent').exists({
        'entity.uuid': asteroidEntity.uuid,
        permission: Permission.IDS.USE_LOT
      }),
      mongoose.model('PublicPolicyComponent').exists({
        'entity.uuid': asteroidEntity.uuid,
        permission: Permission.IDS.USE_LOT
      })
    ]);

    return hasPrepaidMerklePolicy || hasContractPolicy || hasPrepaidPolicy || hasPublicPolicy;
  }

  static async getLotsWithBuildingControlledByAsteroidController(asteroidEntity) {
    const _asteroidEntity = Entity.toEntity(asteroidEntity);
    if (!_asteroidEntity.isAsteroid()) throw new Error('Invalid asteroid entity');

    const asteroidControllerDoc = await mongoose.model('ControlComponent')
      .findOne({ 'entity.uuid': asteroidEntity.uuid });
    if (!asteroidControllerDoc) return [];

    const result = await mongoose.model('LocationComponent').aggregate([
      // match on all locations for the specified asteroid that have a building
      { $match: { 'locations.uuid': _asteroidEntity.uuid, 'entity.label': 5 } },

      // get the matching building component
      {
        $lookup: {
          from: 'Component_Building',
          localField: 'entity.uuid',
          foreignField: 'entity.uuid',
          as: 'Buliding'
        }
      },

      // building status must be greater than 0
      { $match: { 'Buliding.status': { $gt: 0 } } },

      // lookup the controllers for the building(s)
      {
        $lookup: {
          from: 'Component_Control',
          localField: 'entity.uuid',
          foreignField: 'entity.uuid',
          as: 'Control'
        }
      },

      // filter for buildings controlled by the asteroid controller
      { $match: { 'Control.controller.uuid': asteroidControllerDoc.controller.uuid } },

      // only return the location property for the LocationComponent document
      { $project: { location: 1 } }
    ]);

    return result.map((doc) => new Entity(doc.location));
  }

  static async getLotUseEntity(lotEntity) {
    const contractComponents = [
      'ContractAgreementComponent', 'PrepaidAgreementComponent', 'WhitelistAgreementComponent'
    ];

    const promises = contractComponents.map((modelName) => ComponentService.findByEntity(modelName, lotEntity, {
      filter: { permission: Permission.IDS.USE_LOT }
    }));
    const agreementDocs = flatten(await Promise.all(promises));

    return (agreementDocs.length > 0) ? agreementDocs[0].permitted : null;
  }

  static async getLotOccupation(lotUseEntity, asteroidEntity, buildingControllerEntity) {
    let asteroidControllerEntity;

    if (asteroidEntity) {
      const asteroidControlDoc = await ComponentService.findOneByEntity('ControlComponent', asteroidEntity);
      asteroidControllerEntity = asteroidControlDoc?.controller;
    }

    if (buildingControllerEntity) {
      if (Entity.areEqual(buildingControllerEntity, lotUseEntity)) {
        if (Entity.areEqual(buildingControllerEntity, asteroidControllerEntity)) return 'manager';
        return 'tenant';
      }
      return 'squatter';
    }
    return null;
  }
}

module.exports = LotService;
