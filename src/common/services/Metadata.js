const appConfig = require('config');
const Entity = require('@common/lib/Entity');
const { Asteroid, Crewmate, Ship } = require('@influenceth/sdk');
const EntityService = require('@common/services/Entity');

class MetadataService {
  static async getAsteroidMetadata({ id, entity, originUrl, includeDynamicData = true }) {
    if (!id && !entity) throw new Error('id or entity required');
    const entityDoc = entity || await EntityService.getEntity({
      id,
      label: Entity.IDS.ASTEROID,
      components: ['Celestial', 'Orbit', 'Name', 'AsteroidReward'],
      format: true
    });

    if (!entityDoc) throw new Error('Asteroid not found');
    const imageBaseUrl = appConfig.App.imagesServerUrl || originUrl;

    let description = 'A ';

    // Describe the subjective size of the asteroid
    const size = Asteroid.Entity.getSize(entityDoc);
    if (size) description += `${size.toLowerCase()},`;

    // Describe the rarity
    let rarity = 'Common';

    if (entityDoc.Celestial?.scanStatus >= 2) {
      rarity = Asteroid.Entity.getRarity(entityDoc);
      description += ` ${rarity.toLowerCase()},`;
    } else {
      description += ' un-scanned,';
    }

    description += ` ${Asteroid.Entity.getSpectralType(entityDoc)}-type asteroid`;
    const metadata = {
      name: entityDoc.Name?.name || `${entityDoc.id}-${Asteroid.Entity.getSpectralType(entityDoc)}`, // ERC721 standard
      image: `${imageBaseUrl}/v2/asteroids/${entityDoc.id}/image.png`, // ERC721 standard
      description, // ERC721 standard
      external_url: `${appConfig.get('App.clientUrl')}/asteroids/${entityDoc.id}`, // Supported by OpenSea
      background_color: '000000', // Supported by OpenSea
      attributes: [ // Supported by OpenSea
        {
          trait_type: 'Spectral Type',
          value: Asteroid.Entity.getSpectralType(entityDoc)
        },
        {
          trait_type: 'Diameter (m)',
          display_type: 'number',
          value: (entityDoc.Celestial?.radius) ? Math.round(entityDoc.Celestial.radius * 2000) : null
        },
        {
          trait_type: 'Lots',
          display_type: 'number',
          value: Asteroid.Entity.getSurfaceArea(entityDoc)
        },
        {
          trait_type: 'Semi-major Axis (AU)',
          display_type: 'number',
          value: (entityDoc.Orbit?.a) ? Number(entityDoc.Orbit.a) / 1.495978707e8 : null
        },
        {
          trait_type: 'Eccentricity',
          display_type: 'number',
          value: entityDoc.Orbit.ecc
        },
        {
          trait_type: 'Inclination (deg)',
          display_type: 'number',
          value: (entityDoc.Orbit?.inc) ? Number(((entityDoc.Orbit.inc * 180) / Math.PI).toFixed(2)) : null
        },
        {
          trait_type: 'Argument of Periapsis (deg)',
          display_type: 'number',
          value: (entityDoc.Orbit?.argp) ? Number(((entityDoc.Orbit.argp * 180) / Math.PI).toFixed(2)) : null
        },
        {
          trait_type: 'Longitude of Ascending Node (deg)',
          display_type: 'number',
          value: (entityDoc.Orbit?.raan) ? Number(((entityDoc.Orbit.raan * 180) / Math.PI).toFixed(2)) : null
        },
        {
          trait_type: 'Mean Anomaly (deg)',
          display_type: 'number',
          value: (entityDoc.Orbit?.m) ? Number(((entityDoc.Orbit.m * 180) / Math.PI).toFixed(2)) : null
        }
      ]
    };

    const po = entityDoc.Celestial?.purchaseOrder || 0;

    // Add collection information
    if (po > 0 && po <= 11469) {
      let collection;

      if (po > 0 && po <= 1859) collection = 'Arrival';
      if (po > 1859 && po <= 11100) collection = 'Populate the Belt';
      if (po > 11100 && po <= 11469) collection = 'Prepare for Launch';

      metadata.attributes.push({ trait_type: 'Collection', value: collection });
    }

    // Only add the following when dynamic metadata is supported
    if (includeDynamicData) {
      metadata.attributes.push({
        trait_type: 'Scanned',
        value: entityDoc.Celestial?.scanStatus >= 2 ? 'Yes' : 'No'
      });

      // Parse bonuses and add bonus % into metadata
      if (entityDoc.Celestial?.scanStatus >= 2) {
        metadata.attributes.push({ trait_type: 'Rarity', value: rarity });

        Asteroid.Entity.getBonuses(entityDoc).forEach((bonus) => {
          if (bonus.level > 0) {
            metadata.attributes.push({
              trait_type: bonus.name,
              display_type: 'boost_percentage',
              value: bonus.modifier
            });
          }
        });
      } else if (entityDoc.Celestial?.scanStatus === 1) {
        metadata.attributes.push({ trait_type: 'Scanning', value: 'Scanning in progress' });
      } else if (entityDoc.Celestial?.scanStatus === 0) {
        let scanningBonus = '1x';
        if (po > 0 && po <= 100) scanningBonus = '4x';
        if (po > 100 && po <= 1100) scanningBonus = '3x';
        if (po > 1100 && po <= 11100) scanningBonus = '2x';
        metadata.attributes.push({ trait_type: 'Scanning Bonus', value: scanningBonus });
      }

      // Determine if there are any mintable crewmates available
      if (entityDoc.AsteroidReward?.hasMintableCrewmate) {
        let crewMintingStatus;
        if (po > 0 && po <= 1859) crewMintingStatus = 'Arvad Specialist';
        if (po > 1859 && po <= 11100) crewMintingStatus = 'Arvad Citizen';

        if (crewMintingStatus) {
          metadata.attributes.push({ trait_type: 'Can Mint Crewmate', value: crewMintingStatus });
        }
      }

      if (entityDoc.AsteroidReward?.hasPrepareForLaunchCrewmate) {
        metadata.attributes.push({ trait_type: 'Can Mint Crewmate', value: 'Adalian' });
      }

      if (entityDoc.AsteroidReward?.hasSwayClaim) {
        metadata.attributes.push({ trait_type: 'Can Claim SWAY', value: 'Yes' });
      }
    }

    return metadata;
  }

  static async getCrewmateMetadata({ id, entity, originUrl, includeDynamicData = true }) {
    if (!id && !entity) throw new Error('id or entity required');
    const entityDoc = entity || await EntityService.getEntity({
      id,
      label: Entity.IDS.CREWMATE,
      components: ['Crewmate', 'CrewmateReward', 'Name'],
      format: true
    });

    if (!entityDoc) throw new Error('Crewmate not found');
    const imageBaseUrl = appConfig.App.imagesServerUrl || originUrl;

    const metadata = {
      name: entityDoc.Name?.name || `Crewmate #${entityDoc.id}`, // ERC721 standard
      image: `${imageBaseUrl}/v2/crewmates/${entityDoc.id}/image.png`, // ERC721 standard
      external_url: `${appConfig.get('App.clientUrl')}/crewmates/${entityDoc.id}`, // Supported by OpenSea
      background_color: '000000' // Supported by OpenSea
    };

    if (entityDoc.Crewmate) {
      const { class: crewClass, coll: collection, title } = entityDoc.Crewmate;
      const appearance = Crewmate.Entity.unpackAppearance(entityDoc);
      const { gender, body, hair, hairColor, face, clothes, head, item } = appearance;

      if (gender && crewClass && collection <= 3) {
        metadata.description = `A ${Crewmate.getGender(gender).name.toLowerCase()} `
         + `${Crewmate.getClass(crewClass).name} and former ${Crewmate.getCollection(collection).name} `
         + `(${Crewmate.getTitle(title).name})`;
      } else if (gender && crewClass && collection === 4) {
        metadata.description = `A ${Crewmate.getGender(gender).name.toLowerCase()} `
         + `${Crewmate.getClass(crewClass).name} and native born Adalian`;
      }

      const attributes = [];
      attributes.push({ trait_type: 'Collection', value: Crewmate.getCollection(collection).name });

      if (entityDoc.Crewmate.class) attributes.push({ trait_type: 'Class', value: Crewmate.getClass(crewClass).name });
      if (entityDoc.Crewmate.title) attributes.push({ trait_type: 'Title', value: Crewmate.getTitle(title).name });
      if (gender) {
        attributes.push({ trait_type: 'Gender', value: Crewmate.getGender(gender).name });
      }

      if (body) attributes.push({ trait_type: 'Body Type', value: body });
      if (Number.isInteger(hair)) {
        attributes.push({ trait_type: 'Hair Style', value: Crewmate.getHair(hair).name });
      }

      if (hairColor) {
        attributes.push({ trait_type: 'Hair Color', value: Crewmate.getHairColor(hairColor).name });
      }

      if (face) {
        attributes.push({ trait_type: 'Facial Feature', value: Crewmate.getFace(face).name });
      }

      if (clothes) {
        attributes.push({ trait_type: 'Clothes', value: Crewmate.getClothes(clothes).name });
      }

      if (head) {
        attributes.push({ trait_type: 'Headwear', value: Crewmate.getHead(head).name });
      }

      if (item) {
        attributes.push({ trait_type: 'Special Item', value: Crewmate.getItem(item).name });
      }

      metadata.attributes = attributes;
    }

    // Only show when metadata is not static
    if (entityDoc.CrewmateReward?.hasSwayClaim && includeDynamicData) {
      metadata.attributes.push({ trait_type: 'Can Claim SWAY', value: 'Yes' });
    }

    return metadata;
  }

  static async getCrewMetadata({ id, entity, originUrl }) {
    if (!id && !entity) throw new Error('id or entity required');
    const entityDoc = entity || await EntityService.getEntity({
      id,
      label: Entity.IDS.CREW,
      components: ['Crew', 'Name'],
      format: true
    });

    if (!entityDoc) throw new Error('Crew not found');
    const imageBaseUrl = appConfig.App.imagesServerUrl || originUrl;

    const metadata = {
      name: entityDoc.Name?.name || `Crew #${entityDoc.id}`, // ERC721 standard
      image: `${imageBaseUrl}/v2/crews/${entityDoc.id}/image.png`, // ERC721 standard
      external_url: `${appConfig.get('App.clientUrl')}/crew/${entityDoc.id}`, // Supported by OpenSea
      background_color: '000000' // Supported by OpenSea
    };

    if (entityDoc.Crew?.roster?.length > 0) {
      metadata.description = `A hard scrabble Adalian crew of ${entityDoc.Crew.roster?.length}`; // ERC721 standard
      const captain = entityDoc.Crew.roster[0];
      const crewmate = await EntityService.getEntity({
        id: captain, label: Entity.IDS.CREWMATE, components: ['Name'], format: true
      });

      metadata.attributes = [
        { trait_type: 'Captain', value: crewmate?.Name?.name || `Crewmate #${captain}` },
        { trait_type: 'Size', value: entityDoc.Crew.roster?.length }
      ];
    }

    return metadata;
  }

  static async getShipMetadata({ id, entity, originUrl }) {
    if (!id && !entity) throw new Error('id or entity required');
    const entityDoc = entity || await EntityService.getEntity({
      id,
      label: Entity.IDS.SHIP,
      components: ['Name', 'Ship'],
      format: true
    });

    if (!entityDoc) throw new Error('Ship not found');
    const imageBaseUrl = appConfig.App.imagesServerUrl || originUrl;

    const metadata = {
      name: entityDoc.Name?.name || `Ship #${entityDoc.id}`, // ERC721 standard
      image: `${imageBaseUrl}/v2/ships/${entityDoc.id}/image.png`, // ERC721 standard
      external_url: `${appConfig.get('App.clientUrl')}/ship/${entityDoc.id}`, // Supported by OpenSea
      background_color: '000000' // Supported by OpenSea
    };

    const shipType = Ship.getType(entityDoc.Ship?.shipType)?.name || 'Unknown';
    const shipVariant = Ship.getVariant(entityDoc.Ship?.variant)?.name || 'Unknown';

    metadata.description = `A ${shipVariant} variant ${shipType} ship`; // ERC721 standard

    metadata.attributes = [
      { trait_type: 'Ship Type', value: shipType },
      { trait_type: 'Variant', value: shipVariant }
    ];

    return metadata;
  }
}

module.exports = MetadataService;
