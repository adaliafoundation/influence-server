const { expect } = require('chai');
const mongoose = require('mongoose');
const moment = require('moment');
const Handler = require('@common/lib/events/handlers/ethereum/SwayGovernor/AssignmentSwayClaimed');

describe('SwayGovernor::AssignmentSwayClaimed event handler', function () {
  afterEach(function () {
    return this.utils.resetCollections(['Event', 'AsteroidRewardComponent', 'CrewmateRewardComponent']);
  });

  describe('processEvent', function () {
    it('should mark any asteroid or crewmate reward docs which hasSwayClaim=false ', async function () {
      const eventDoc = mongoose.model('Ethereum')({
        event: 'AssignmentSwayClaimed',
        blockNumber: 1,
        transactionHash: '0x123456789',
        returnValues: {
          0: '0x55A30026e0896CFee359a5762BeA418D989b7682',
          1: ['1', '2', '3', '4'],
          2: ['5', '6', '7', '8'],
          3: '100',
          address: '0x55A30026e0896CFee359a5762BeA418D989b7682',
          asteroidIds: ['1', '2', '3', '4'],
          crewmateIds: ['5', '6', '7', '8'],
          amount: '100'
        },
        timestamp: moment().unix()
      });

      await (new Handler(eventDoc)).processEvent();

      const asteroidRewardCompDocs = await mongoose.model('AsteroidRewardComponent').find({});
      expect(asteroidRewardCompDocs).to.have.lengthOf(4);
      expect(asteroidRewardCompDocs.map(({ entity }) => entity.id))
        .to.include.members([1, 2, 3, 4]);
      expect(asteroidRewardCompDocs.map(({ hasSwayClaim }) => hasSwayClaim))
        .to.deep.equal([false, false, false, false]);

      const crewmateRewardCompDocs = await mongoose.model('CrewmateRewardComponent').find({});
      expect(crewmateRewardCompDocs).to.have.lengthOf(4);
      expect(crewmateRewardCompDocs.map(({ entity }) => entity.id))
        .to.include.members([5, 6, 7, 8]);
      expect(crewmateRewardCompDocs.map(({ hasSwayClaim }) => hasSwayClaim))
        .to.deep.equal([false, false, false, false]);
    });
  });
});
