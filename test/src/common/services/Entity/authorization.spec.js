const { expect } = require('chai');
const mongoose = require('mongoose');
const { Authorization, Permission, Time } = require('@influenceth/sdk');
const Entity = require('@common/lib/Entity');
const { EntityService } = require('@common/services');

const permission = Permission.IDS.ADD_PRODUCTS;
const labels = [Entity.IDS.BUILDING, Entity.IDS.SHIP];

labels.forEach((label) => describe(`Entity SDK authorization compatibility (label ${label})`, function () {
  const components = [
    'Control', 'PublicPolicy', 'WhitelistAgreement', 'WhitelistAccountAgreement',
    'PrepaidAgreement', 'ContractAgreement'
  ];
  const crew = { id: 1, label: 1, Crew: { delegatedTo: '0x1' } };
  const day = 86400;
  let now;

  beforeEach(function () {
    now = Math.floor(Date.now() / 1000);
  });

  afterEach(function () {
    return this.utils.resetCollections(['Entity', 'PrepaidAgreementComponent']);
  });

  describe('prepaid agreements', function () {
    const entity = { id: 1, label };
    const evaluate = async (until) => {
      const target = await EntityService.getEntity({ ...entity, components, format: true });
      return Authorization.evaluate({
        entities: [crew, target],
        evaluationTime: now,
        permitted: crew,
        target,
        permission,
        until
      });
    };
    const agreement = () => ({
      entity,
      permission,
      permitted: crew,
      endTime: now - 20 * day,
      noticeTime: now - day,
      noticePeriod: 2 * day
    });

    it(`should retain notice-protected agreements for entity label ${entity.label}`, async function () {
      await mongoose.model('PrepaidAgreementComponent').create(agreement());
      expect((await evaluate()).status).to.equal('allowed');
      const completionTime = Time.getProductionCompletionTime(now, now + day - 1, 1);
      expect((await evaluate(completionTime)).status).to.equal('allowed');
      expect((await evaluate(completionTime + 1)).reason).to.equal('expired-prepaid-agreement');
    });

    it(`should preserve revoked agreements for entity label ${entity.label}`, async function () {
      await mongoose.model('PrepaidAgreementComponent').create({ ...agreement(), endTime: 0 });
      expect((await evaluate(now)).reason).to.equal('revoked-prepaid-agreement');
    });

    it(`should leave incomplete agreements unresolved for entity label ${entity.label}`, async function () {
      await mongoose.model('PrepaidAgreementComponent').create({ ...agreement(), noticePeriod: undefined });
      const result = await evaluate();
      expect(result.status).to.equal('unresolved');
      expect(result.reason).to.equal('incomplete-component');
    });
  });

  it('should distinguish absent requested components from unloaded components', async function () {
    const entity = { id: 1, label };
    const complete = await EntityService.getEntity({ ...entity, components, format: true });
    const partial = await EntityService.getEntity({ ...entity, components: ['Control'], format: true });
    const evaluate = (target) => Authorization.evaluate({
      entities: [crew, target], evaluationTime: now, permitted: crew, target, permission: Permission.IDS.ADD_PRODUCTS
    });
    expect(complete.Control).to.equal(null);
    expect(complete.PublicPolicies).to.deep.equal([]);
    expect(evaluate(complete).status).to.equal('denied');
    expect(partial).not.to.have.property('PublicPolicies');
    expect(evaluate(partial).status).to.equal('unresolved');
  });
}));
