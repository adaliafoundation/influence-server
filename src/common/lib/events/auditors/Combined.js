const logger = require('@common/lib/logger');
const EthereumAuditor = require('./ethereum');
const StarknetAuditor = require('./starknet');

class CombinedEventAuditor {
  constructor(props = {}) {
    this.ethereumAuditor = props.ethereumAuditor || new EthereumAuditor();
    this.starknetAuditor = props.starknetAuditor || new StarknetAuditor();
  }

  static logAuditResult(logSlug, chain, result = {}) {
    if (!result) return;

    const summary = [
      `head=${result.headBlock}`,
      `finalized=${result.finalizedBlock}`,
      `start=${result.startBlock}`,
      `end=${result.endBlock}`,
      `mismatched=${result.mismatchedBlocks || 0}`
    ];

    if (Number.isFinite(result.refreshedBlocks)) summary.push(`refreshed=${result.refreshedBlocks}`);
    if (Number.isFinite(result.finalizedTimestamp)) summary.push(`finalizedTimestamp=${result.finalizedTimestamp}`);

    logger.info(`${logSlug}, ${chain} result: ${summary.join(', ')}`);
  }

  async runOnce() {
    const results = {};

    try {
      results.ethereum = await this.ethereumAuditor.auditOnce();
      CombinedEventAuditor.logAuditResult('CombinedEventAuditor::runOnce', 'ethereum', results.ethereum);
    } catch (error) {
      logger.error('CombinedEventAuditor::runOnce, ethereum audit failed');
      logger.error(error);
      results.ethereum = { error };
    }

    try {
      results.starknet = await this.starknetAuditor.auditOnce();
      CombinedEventAuditor.logAuditResult('CombinedEventAuditor::runOnce', 'starknet', results.starknet);
    } catch (error) {
      logger.error('CombinedEventAuditor::runOnce, starknet audit failed');
      logger.error(error);
      results.starknet = { error };
    }

    return results;
  }
}

module.exports = CombinedEventAuditor;
