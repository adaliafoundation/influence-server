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

    // Determine the NFT entity to check ownership on.
    // Buildings/ships: entity → Control.controller (a crew) → crew's Nft owner.
    // Crews: no Control component — check the crew's Nft directly.
    let nftEntity;
    const controllerEntity = entity.Control?.controller;
    if (controllerEntity) {
      nftEntity = controllerEntity;
    } else if (Entity.isCrew(entity)) {
      nftEntity = entity;
    } else {
      throw new ValidationError('Entity has no controller');
    }

    const nft = await ComponentService.findOneByEntity('Nft', nftEntity);
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
    const crewEntity = Entity.toEntity(crew);

    // For lots, also check permissions on the parent asteroid.
    // In the real game, lot permissions inherit from the asteroid level.
    const entitiesToCheck = [targetEntity];
    if (targetEntity.isLot()) {
      const { asteroidEntity } = targetEntity.unpackLot();
      entitiesToCheck.push(asteroidEntity);
    }

    for (const checkEntity of entitiesToCheck) {
      // 1. Check if entity has a public policy for this permission
      const publicPolicy = await ComponentService.findOne('PublicPolicy', {
        'entity.uuid': checkEntity.uuid,
        permission: permissionId
      });
      if (publicPolicy) return;

      // 2. Check if crew is the controller (or same-wallet owner as controller)
      const control = await ComponentService.findOneByEntity('Control', checkEntity);
      if (control?.controller) {
        const controllerEntity = Entity.toEntity(control.controller);
        if (controllerEntity.uuid === crewEntity.uuid) return;

        // Also grant access if the requesting crew is owned by the same wallet
        // as the entity's controller crew (all crews under one wallet share access)
        const controllerNft = await ComponentService.findOneByEntity('Nft', controllerEntity);
        const crewNft = await ComponentService.findOneByEntity('Nft', crewEntity);
        if (controllerNft && crewNft) {
          const controllerOwner = controllerNft.owners?.starknet || controllerNft.owners?.ethereum;
          const crewOwner = crewNft.owners?.starknet || crewNft.owners?.ethereum;
          if (controllerOwner && crewOwner
            && Address.toStandard(controllerOwner) === Address.toStandard(crewOwner)) {
            return;
          }
        }
      }

      // 3. Check whitelist
      const whitelist = await ComponentService.findOne('WhitelistAgreement', {
        'entity.uuid': checkEntity.uuid,
        'target.uuid': crewEntity.uuid,
        permission: permissionId
      });
      if (whitelist) return;

      // 4. Check prepaid agreements
      const now = Math.floor(Date.now() / 1000);
      const prepaid = await ComponentService.findOne('PrepaidPolicy', {
        'entity.uuid': checkEntity.uuid,
        'target.uuid': crewEntity.uuid,
        permission: permissionId,
        endTime: { $gt: now }
      });
      if (prepaid) return;

      // 5. Check contract policy
      const contractPolicy = await ComponentService.findOne('ContractPolicy', {
        'entity.uuid': checkEntity.uuid,
        permission: permissionId
      });
      if (contractPolicy) return;
    }

    throw new ValidationError(`Permission denied: missing permission ${permissionId} on entity`);
  }
}

module.exports = AccessValidator;
