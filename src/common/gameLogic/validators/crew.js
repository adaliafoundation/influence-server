const { Address } = require('@influenceth/sdk');
const { ValidationError } = require('../errors');

class CrewValidator {
  /**
   * Asserts the crew is ready (not currently performing another action).
   * @param {object} crew - Formatted crew entity with Crew component
   */
  static assertReady(crew) {
    if (!crew?.Crew) throw new ValidationError('Crew component not found');

    const now = Math.floor(Date.now() / 1000);
    if (crew.Crew.readyAt && crew.Crew.readyAt > now) {
      throw new ValidationError(`Crew is busy until ${crew.Crew.readyAt}`);
    }
  }

  /**
   * Asserts the crew has been fed (not starving).
   * Food consumption is tracked via lastFed timestamp.
   * @param {object} crew - Formatted crew entity with Crew component
   */
  static assertFed(crew) {
    if (!crew?.Crew) throw new ValidationError('Crew component not found');

    // TODO: Implement food/starvation validation. Currently a no-op because
    // the contract allows unfed crews to act until the starvation penalty
    // kicks in, and we don't yet replicate that penalty calculation locally.
  }

  /**
   * Asserts the crew has a valid roster (at least one crewmate).
   * @param {object} crew - Formatted crew entity with Crew component
   */
  static assertHasRoster(crew) {
    if (!crew?.Crew) throw new ValidationError('Crew component not found');
    if (!crew.Crew.roster || crew.Crew.roster.length === 0) {
      throw new ValidationError('Crew has no crewmates');
    }
  }

  /**
   * Asserts the crew is delegated to the given address.
   * @param {object} crew - Formatted crew entity with Crew component
   * @param {string} address - Wallet address to check delegation for
   */
  static assertDelegated(crew, address) {
    if (!crew?.Crew) throw new ValidationError('Crew component not found');
    if (!crew.Crew.delegatedTo) throw new ValidationError('Crew is not delegated');

    if (Address.toStandard(crew.Crew.delegatedTo) !== Address.toStandard(address)) {
      throw new ValidationError('Crew is not delegated to this address');
    }
  }
}

module.exports = CrewValidator;
