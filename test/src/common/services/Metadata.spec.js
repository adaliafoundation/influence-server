const { expect } = require('chai');
const mongoose = require('mongoose');
const Entity = require('@common/lib/Entity');
const { EntityService, MetadataService } = require('@common/services');

describe('MetadataService', function () {
  const originUrl = 'https://example.com';

  afterEach(function () {
    return this.utils.resetCollections([
      'AsteroidRewardComponent',
      'CelestialComponent',
      'CrewComponent',
      'CrewmateComponent',
      'CrewmateRewardComponent',
      'NameComponent',
      'OrbitComponent',
      'ShipComponent'
    ]);
  });

  describe('getAsteroidMetadata', function () {
    beforeEach(async function () {
      const entity = Entity.Asteroid(1);
      await Promise.all([
        mongoose.model('CelestialComponent').create({
          entity,
          abundances: '0x7f0a4bd0c8141280000000001f3',
          bonuses: 0,
          celestialType: 1,
          mass: 1329730329406897600000000000,
          purchaseOrder: 1,
          radius: 375.1419399997685,
          scanFinishTime: 0,
          scanStatus: 4
        }),
        mongoose.model('OrbitComponent').create({
          entity,
          a: 327918532.5744,
          argp: 5.283809777487633,
          ecc: 0.325,
          inc: 0.002443460952792061,
          m: 0.9480628496833199,
          raan: 3.4108969571725183
        }),
        mongoose.model('NameComponent').create({ entity, name: 'Test Asteroid' }),
        mongoose.model('AsteroidRewardComponent').create({ entity, hasMintableCrewmate: true })
      ]);
    });

    it('should return the correct metadata for an asteroid (by id)', async function () {
      const metadata = await MetadataService.getAsteroidMetadata({ id: 1, originUrl });
      expect(metadata).to.deep.equal({
        name: 'Test Asteroid',
        image: 'IMAGES_SERVER_URL/v2/asteroids/1/image.png',
        description: 'A huge, common, C-type asteroid',
        external_url: 'http://localhost.local/asteroids/1',
        background_color: '000000',
        attributes: [
          { trait_type: 'Spectral Type', value: 'C' },
          {
            trait_type: 'Diameter (m)',
            display_type: 'number',
            value: 750284
          },
          { trait_type: 'Lots', display_type: 'number', value: 1768483 },
          {
            trait_type: 'Semi-major Axis (AU)',
            display_type: 'number',
            value: 2.192
          },
          {
            trait_type: 'Eccentricity',
            display_type: 'number',
            value: 0.325
          },
          {
            trait_type: 'Inclination (deg)',
            display_type: 'number',
            value: 0.14
          },
          {
            trait_type: 'Argument of Periapsis (deg)',
            display_type: 'number',
            value: 302.74
          },
          {
            trait_type: 'Longitude of Ascending Node (deg)',
            display_type: 'number',
            value: 195.43
          },
          {
            trait_type: 'Mean Anomaly (deg)',
            display_type: 'number',
            value: 54.32
          },
          {
            trait_type: 'Collection',
            value: 'Arrival'
          },
          { trait_type: 'Scanned', value: 'Yes' },
          { trait_type: 'Rarity', value: 'Common' },
          {
            trait_type: 'Can Mint Crewmate',
            value: 'Arvad Specialist'
          }
        ]
      });
    });

    it('should return the correct metadata for an asteroid (by entity)', async function () {
      const entity = await EntityService.getEntity({
        id: 1,
        label: Entity.IDS.ASTEROID,
        components: ['Celestial', 'Orbit', 'Name', 'AsteroidReward'],
        format: true
      });
      const metadata = await MetadataService.getAsteroidMetadata({ entity, originUrl });
      expect(metadata).to.deep.equal({
        name: 'Test Asteroid',
        image: 'IMAGES_SERVER_URL/v2/asteroids/1/image.png',
        description: 'A huge, common, C-type asteroid',
        external_url: 'http://localhost.local/asteroids/1',
        background_color: '000000',
        attributes: [
          { trait_type: 'Spectral Type', value: 'C' },
          {
            trait_type: 'Diameter (m)',
            display_type: 'number',
            value: 750284
          },
          { trait_type: 'Lots', display_type: 'number', value: 1768483 },
          {
            trait_type: 'Semi-major Axis (AU)',
            display_type: 'number',
            value: 2.192
          },
          {
            trait_type: 'Eccentricity',
            display_type: 'number',
            value: 0.325
          },
          {
            trait_type: 'Inclination (deg)',
            display_type: 'number',
            value: 0.14
          },
          {
            trait_type: 'Argument of Periapsis (deg)',
            display_type: 'number',
            value: 302.74
          },
          {
            trait_type: 'Longitude of Ascending Node (deg)',
            display_type: 'number',
            value: 195.43
          },
          {
            trait_type: 'Mean Anomaly (deg)',
            display_type: 'number',
            value: 54.32
          },
          {
            trait_type: 'Collection',
            value: 'Arrival'
          },
          { trait_type: 'Scanned', value: 'Yes' },
          { trait_type: 'Rarity', value: 'Common' },
          {
            trait_type: 'Can Mint Crewmate',
            value: 'Arvad Specialist'
          }
        ]
      });
    });

    it('should exclude dynamic data when includeDynamicData is false', async function () {
      const metadata = await MetadataService.getAsteroidMetadata({ id: 1, originUrl, includeDynamicData: false });
      expect(metadata).to.deep.equal({
        name: 'Test Asteroid',
        image: 'IMAGES_SERVER_URL/v2/asteroids/1/image.png',
        description: 'A huge, common, C-type asteroid',
        external_url: 'http://localhost.local/asteroids/1',
        background_color: '000000',
        attributes: [
          { trait_type: 'Spectral Type', value: 'C' },
          {
            trait_type: 'Diameter (m)',
            display_type: 'number',
            value: 750284
          },
          { trait_type: 'Lots', display_type: 'number', value: 1768483 },
          {
            trait_type: 'Semi-major Axis (AU)',
            display_type: 'number',
            value: 2.192
          },
          {
            trait_type: 'Eccentricity',
            display_type: 'number',
            value: 0.325
          },
          {
            trait_type: 'Inclination (deg)',
            display_type: 'number',
            value: 0.14
          },
          {
            trait_type: 'Argument of Periapsis (deg)',
            display_type: 'number',
            value: 302.74
          },
          {
            trait_type: 'Longitude of Ascending Node (deg)',
            display_type: 'number',
            value: 195.43
          },
          {
            trait_type: 'Mean Anomaly (deg)',
            display_type: 'number',
            value: 54.32
          },
          {
            trait_type: 'Collection',
            value: 'Arrival'
          }
        ]
      });
    });
  });

  describe('getCrewmateMetadata', function () {
    beforeEach(async function () {
      const entity = Entity.Crewmate(1);
      await Promise.all([
        mongoose.model('CrewmateComponent').create({
          entity,
          appearance: '0x2000020007000000092',
          class: 1,
          coll: 4,
          cosmetic: [1, 36, 5, 15, 10],
          impactful: [28, 41, 46, 29, 31],
          title: 66,
          status: 1
        }),
        mongoose.model('CrewmateRewardComponent').create({ entity, hasSwayClaim: true }),
        mongoose.model('NameComponent').create({ entity, name: 'Test Crewmate' })
      ]);
    });

    it('should return the correct metadata for a crewmate (by id)', async function () {
      const metadata = await MetadataService.getCrewmateMetadata({ id: 1, originUrl });
      expect(metadata).to.deep.equal({
        name: 'Test Crewmate',
        image: 'IMAGES_SERVER_URL/v2/crewmates/1/image.png',
        external_url: 'http://localhost.local/crewmates/1',
        background_color: '000000',
        description: 'A female Pilot and native born Adalian',
        attributes: [
          { trait_type: 'Collection', value: 'Adalian' },
          { trait_type: 'Class', value: 'Pilot' },
          { trait_type: 'Title', value: 'Adalian Prime Councilor' },
          { trait_type: 'Gender', value: 'Female' },
          { trait_type: 'Body Type', value: 9 },
          { trait_type: 'Hair Style', value: 'Long' },
          { trait_type: 'Hair Color', value: 'Gray' },
          { trait_type: 'Clothes', value: 'Pilot Recruit - Primary' },
          { trait_type: 'Can Claim SWAY', value: 'Yes' }
        ]
      });
    });

    it('should return the correct metadata for a crewmate (by entity)', async function () {
      const entity = await EntityService.getEntity({
        id: 1,
        label: Entity.IDS.CREWMATE,
        components: ['Crewmate', 'CrewmateReward', 'Name'],
        format: true
      });
      const metadata = await MetadataService.getCrewmateMetadata({ entity, originUrl });
      expect(metadata).to.deep.equal({
        name: 'Test Crewmate',
        image: 'IMAGES_SERVER_URL/v2/crewmates/1/image.png',
        external_url: 'http://localhost.local/crewmates/1',
        background_color: '000000',
        description: 'A female Pilot and native born Adalian',
        attributes: [
          { trait_type: 'Collection', value: 'Adalian' },
          { trait_type: 'Class', value: 'Pilot' },
          { trait_type: 'Title', value: 'Adalian Prime Councilor' },
          { trait_type: 'Gender', value: 'Female' },
          { trait_type: 'Body Type', value: 9 },
          { trait_type: 'Hair Style', value: 'Long' },
          { trait_type: 'Hair Color', value: 'Gray' },
          { trait_type: 'Clothes', value: 'Pilot Recruit - Primary' },
          { trait_type: 'Can Claim SWAY', value: 'Yes' }
        ]
      });
    });

    it('should return the correct metadata for a crewmate when includeDynamicData is false', async function () {
      const metadata = await MetadataService.getCrewmateMetadata({ id: 1, originUrl, includeDynamicData: false });
      expect(metadata).to.deep.equal({
        name: 'Test Crewmate',
        image: 'IMAGES_SERVER_URL/v2/crewmates/1/image.png',
        external_url: 'http://localhost.local/crewmates/1',
        background_color: '000000',
        description: 'A female Pilot and native born Adalian',
        attributes: [
          { trait_type: 'Collection', value: 'Adalian' },
          { trait_type: 'Class', value: 'Pilot' },
          { trait_type: 'Title', value: 'Adalian Prime Councilor' },
          { trait_type: 'Gender', value: 'Female' },
          { trait_type: 'Body Type', value: 9 },
          { trait_type: 'Hair Style', value: 'Long' },
          { trait_type: 'Hair Color', value: 'Gray' },
          { trait_type: 'Clothes', value: 'Pilot Recruit - Primary' }
        ]
      });
    });
  });

  describe('getCrewMetadata', function () {
    beforeEach(async function () {
      const entity = Entity.Crew(1);
      await Promise.all([
        mongoose.model('CrewComponent').create({
          entity,
          actionRound: 0,
          actionType: 0,
          delegatedTo: '0x075c3c31482c1cc0776ac70016514ef526221437c09aa1def8163a235866d093',
          lastFed: 0,
          readyAt: 0,
          roster: [1, 2, 3, 4, 5]
        }),
        mongoose.model('NameComponent').create({ entity, name: 'Test Crew' })
      ]);
    });

    it('should return the correct metadata for a crew (by id)', async function () {
      const metadata = await MetadataService.getCrewMetadata({ id: 1, originUrl });

      expect(metadata).to.deep.equal({
        name: 'Test Crew',
        image: 'IMAGES_SERVER_URL/v2/crews/1/image.png',
        external_url: 'http://localhost.local/crew/1',
        background_color: '000000',
        description: 'A hard scrabble Adalian crew of 5',
        attributes: [
          { trait_type: 'Captain', value: 'Crewmate #1' },
          { trait_type: 'Size', value: 5 }
        ]
      });
    });

    it('should return the correct metadata for a crew (by entity)', async function () {
      const entity = await EntityService.getEntity({
        id: 1,
        label: Entity.IDS.CREW,
        components: ['Crew', 'Name'],
        format: true
      });
      await mongoose.model('NameComponent').create({ entity: Entity.Crewmate(1), name: 'Test Crewmate' });

      const metadata = await MetadataService.getCrewMetadata({ entity, originUrl });
      expect(metadata).to.deep.equal({
        name: 'Test Crew',
        image: 'IMAGES_SERVER_URL/v2/crews/1/image.png',
        external_url: 'http://localhost.local/crew/1',
        background_color: '000000',
        description: 'A hard scrabble Adalian crew of 5',
        attributes: [
          { trait_type: 'Captain', value: 'Test Crewmate' },
          { trait_type: 'Size', value: 5 }
        ]
      });
    });
  });

  describe('getShipMetadata', function () {
    beforeEach(async function () {
      const entity = Entity.Ship(1);
      await Promise.all([
        mongoose.model('ShipComponent').create({
          entity,
          readyAt: 0,
          shipType: 1,
          status: 3,
          variant: 0
        }),
        mongoose.model('NameComponent').create({ entity, name: 'Test Ship' })
      ]);
    });

    it('should return the correct metadata for a ship (by id)', async function () {
      const metadata = await MetadataService.getShipMetadata({ id: 1, originUrl });
      expect(metadata).to.deep.equal({
        name: 'Test Ship',
        image: 'IMAGES_SERVER_URL/v2/ships/1/image.png',
        external_url: 'http://localhost.local/ship/1',
        background_color: '000000',
        description: 'A Standard variant Escape Module ship',
        attributes: [
          { trait_type: 'Ship Type', value: 'Escape Module' },
          { trait_type: 'Variant', value: 'Standard' }
        ]
      });
    });

    it('should return the correct metadata for an crew (by entity)', async function () {
      const entity = await EntityService.getEntity({
        id: 1,
        label: Entity.IDS.SHIP,
        components: ['Ship', 'Name'],
        format: true
      });

      const metadata = await MetadataService.getShipMetadata({ entity, originUrl });
      expect(metadata).to.deep.equal({
        name: 'Test Ship',
        image: 'IMAGES_SERVER_URL/v2/ships/1/image.png',
        external_url: 'http://localhost.local/ship/1',
        background_color: '000000',
        description: 'A Standard variant Escape Module ship',
        attributes: [
          { trait_type: 'Ship Type', value: 'Escape Module' },
          { trait_type: 'Variant', value: 'Standard' }
        ]
      });
    });
  });
});
