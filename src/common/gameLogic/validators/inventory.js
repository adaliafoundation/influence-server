const { Inventory, Product } = require('@influenceth/sdk');
const { ValidationError } = require('../errors');

class InventoryValidator {
  /**
   * Asserts that the inventory has sufficient capacity for the given product amount.
   * Checks both mass and volume constraints from the SDK's Inventory.TYPES.
   *
   * @param {object} inventory - InventoryComponent document
   * @param {number} productId - Product ID from Product.IDS
   * @param {number} amount - Amount to add
   */
  static assertCapacity(inventory, productId, amount) {
    if (!inventory) throw new ValidationError('Inventory not found');

    const product = Product.TYPES[productId];
    if (!product) throw new ValidationError(`Unknown product: ${productId}`);

    const invType = Inventory.TYPES[inventory.inventoryType];
    if (!invType) throw new ValidationError(`Unknown inventory type: ${inventory.inventoryType}`);

    const addedMass = (product.massPerUnit || 0) * amount;
    const addedVolume = (product.volumePerUnit || 0) * amount;

    const currentMass = inventory.mass || 0;
    const currentVolume = inventory.volume || 0;
    const reservedMass = inventory.reservedMass || 0;
    const reservedVolume = inventory.reservedVolume || 0;

    if (currentMass + addedMass + reservedMass > invType.massConstraint) {
      throw new ValidationError('Insufficient mass capacity');
    }

    if (currentVolume + addedVolume + reservedVolume > invType.volumeConstraint) {
      throw new ValidationError('Insufficient volume capacity');
    }
  }

  /**
   * Asserts that the inventory contains at least the specified amount of a product.
   *
   * @param {object} inventory - InventoryComponent document with contents array
   * @param {number} productId - Product ID from Product.IDS
   * @param {number} amount - Required amount
   */
  static assertContains(inventory, productId, amount) {
    if (!inventory) throw new ValidationError('Inventory not found');

    const item = (inventory.contents || []).find((c) => c.product === productId);
    const available = item?.amount || 0;

    if (available < amount) {
      throw new ValidationError(`Insufficient product ${productId}: have ${available}, need ${amount}`);
    }
  }
}

module.exports = InventoryValidator;
