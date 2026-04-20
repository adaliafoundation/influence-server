const { Address } = require('@influenceth/sdk');
const Entity = require('@common/lib/Entity');
const { ComponentService } = require('@common/services');
const { ValidationError } = require('../errors');

class AccessValidator {
  /**
   * Asserts that the given entity is controlled by the specified address.
   * Follows the NFT ownership chain: entity -> Control component -> controller crew -> Nft owner.
   *
   * @param {object} entity - Entity with Control component (formatted)
   * @param {string} address - Wallet address to check
   */
  static async assertControlledBy(entity, address) {
    if (!entity) throw new ValidationError('Entity not found');
    if (!address) throw new ValidationError('Address required');

    const controllerEntity = entity.Control?.controller;
    if (!controllerEntity) throw new ValidationError('Entity has no controller');

    // For crews: check the Nft component owner matches the address
    const nft = await ComponentService.findOneByEntity('Nft', controllerEntity);
    if (!nft) throw new ValidationError('Controller NFT not found');

    const ownerAddress = nft.owners?.starknet || nft.owners?.ethereum;
    if (!ownerAddress) throw new ValidationError('Controller has no owner');

    if (Address.toStandard(ownerAddress) !== Address.toStandard(address)) {
      throw new ValidationError('Not authorized: address does not control this entity');
    }
  }

  /**
   * Asserts that the crew has the specified permission on the target entity.
   * Multi-tier check: public policy -> controller -> whitelist -> prepaid -> contract.
   *
   * @param {object} crew - Crew entity (formatted, with Control component)
   * @param {object} target - Target entity (e.g., lot, building)
   * @param {number} permissionId - Permission.IDS value
   */
  static async assertPermission(crew, target, permissionId) {
    if (!crew || !target) throw new ValidationError('Crew and target required');

    const targetEntity = Entity.toEntity(target);

    // 1. Check if target has a public policy for this permission
    const publicPolicy = await ComponentService.findOne('PublicPolicy', {
      'entity.uuid': targetEntity.uuid,
      permission: permissionId
    });
    if (publicPolicy) return;

    // 2. Check if crew is the controller
    const control = await ComponentService.findOneByEntity('Control', targetEntity);
    if (control?.controller) {
      const controllerEntity = Entity.toEntity(control.controller);
      const crewEntity = Entity.toEntity(crew);
      if (controllerEntity.uuid === crewEntity.uuid) return;
    }

    // 3. Check whitelist
    const crewEntity = Entity.toEntity(crew);
    const whitelist = await ComponentService.findOne('Whitelist', {
      'entity.uuid': targetEntity.uuid,
      'target.uuid': crewEntity.uuid,
      permission: permissionId
    });
    if (whitelist) return;

    // 4. Check prepaid agreements
    const now = Math.floor(Date.now() / 1000);
    const prepaid = await ComponentService.findOne('PrepaidPolicy', {
      'entity.uuid': targetEntity.uuid,
      'target.uuid': crewEntity.uuid,
      permission: permissionId,
      endTime: { $gt: now }
    });
    if (prepaid) return;

    // 5. Check contract policy
    const contractPolicy = await ComponentService.findOne('ContractPolicy', {
      'entity.uuid': targetEntity.uuid,
      permission: permissionId
    });
    if (contractPolicy) return;

    throw new ValidationError(`Permission denied: missing permission ${permissionId} on entity`);
  }
}

module.exports = AccessValidator;
