const { expect } = require('chai');
const mongoose = require('mongoose');
const IdGenerator = require('@common/gameLogic/helpers/idGenerator');

const LOCAL_ID_OFFSET = 100_000_000;

describe('IdGenerator', function () {
  afterEach(function () {
    return this.utils.resetCollections(['Counter']);
  });

  it('should return IDs above LOCAL_ID_OFFSET', async function () {
    const id = await IdGenerator.next(5); // entity label 5 = Building
    expect(id).to.be.above(LOCAL_ID_OFFSET);
  });

  it('should return sequential IDs for the same entity label', async function () {
    const id1 = await IdGenerator.next(5);
    const id2 = await IdGenerator.next(5);
    expect(id2).to.equal(id1 + 1);
  });

  it('should maintain separate counters per entity label', async function () {
    const buildingId = await IdGenerator.next(5);
    const crewId = await IdGenerator.next(1);
    // Both should be the first ID for their label
    expect(buildingId).to.equal(LOCAL_ID_OFFSET + 1);
    expect(crewId).to.equal(LOCAL_ID_OFFSET + 1);
  });

  it('should persist counter state across calls', async function () {
    await IdGenerator.next(5);
    await IdGenerator.next(5);
    await IdGenerator.next(5);

    const counter = await mongoose.model('Counter').findOne({ key: 'entity_5' });
    expect(counter.seq).to.equal(3);
  });
});
