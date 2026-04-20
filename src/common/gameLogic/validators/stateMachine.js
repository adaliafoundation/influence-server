const { ValidationError } = require('../errors');

class StateMachineValidator {
  /**
   * Asserts a component's status matches the expected value.
   * Used for equipment status transitions (e.g., Extractor must be IDLE to start).
   *
   * @param {object} component - Component document with a status field
   * @param {number} expectedStatus - Expected status value
   * @param {string} [label] - Human-readable label for error messages
   */
  static assertStatus(component, expectedStatus, label = 'Component') {
    if (!component) throw new ValidationError(`${label} not found`);
    if (component.status !== expectedStatus) {
      throw new ValidationError(
        `${label} status is ${component.status}, expected ${expectedStatus}`
      );
    }
  }

  /**
   * Asserts a time-gated operation has finished (finishTime has passed).
   * Used for construction, extraction, processing, transit completions.
   *
   * @param {object} component - Component with a finishTime field
   * @param {string} [label] - Human-readable label for error messages
   */
  static assertFinished(component, label = 'Component') {
    if (!component) throw new ValidationError(`${label} not found`);
    if (!component.finishTime) throw new ValidationError(`${label} has no finish time`);

    const now = Math.floor(Date.now() / 1000);
    if (component.finishTime > now) {
      throw new ValidationError(
        `${label} not finished yet (finishes at ${component.finishTime}, now ${now})`
      );
    }
  }
}

module.exports = StateMachineValidator;
