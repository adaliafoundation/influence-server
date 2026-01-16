const Entity = require('@common/lib/Entity');
const AsteroidService = require('@common/services/Asteroid');
const CrewService = require('@common/services/Crew');
const CrewmateService = require('@common/services/Crewmate');
const ShipService = require('@common/services/Ship');
const AsteroidCard = require('@common/lib/cdn/AsteroidCard');
const CrewCard = require('@common/lib/cdn/CrewCard');
const CrewmateCard = require('@common/lib/cdn/CrewmateCard');
const ShipCard = require('@common/lib/cdn/ShipCard');

class NftImage {
  constructor(entity) {
    this._entity = Entity.toEntity(entity);
  }

  async buildAndUpdate() {
    let cdn;
    let data;
    const fileType = 'png';
    const contentType = 'image/png';

    switch (this._entity.label) {
      case Entity.IDS.ASTEROID:
        data = await AsteroidService.generateCard({ entity: this._entity, fileType });
        cdn = new AsteroidCard();

        // delete and bust cache
        await cdn.purge(this._entity);

        // upload new image
        await cdn.upload({ contentType, data, doc: this._entity, fileType });

        break;
      case Entity.IDS.CREW:
        data = await CrewService.generateCard({ crewEntity: this._entity, fileType });
        cdn = new CrewCard();

        // delete and bust cache
        await cdn.purge(this._entity);

        // upload new image
        await cdn.upload({ contentType, data, doc: this._entity, fileType });

        break;
      case Entity.IDS.CREWMATE:
        // standard card
        data = await CrewmateService.generateCard({ entity: this._entity, fileType });
        cdn = new CrewmateCard();

        // delete and bust cache (all images for this crewmate)
        await cdn.purge(this._entity);

        // upload new image
        await cdn.upload({ contentType, data, doc: this._entity, fileType });

        // bust only card
        data = await CrewmateService.generateCard({ entity: this._entity, fileType, bustOnly: true });
        cdn = new CrewmateCard();

        // upload new image
        await cdn.upload({ contentType, data, doc: this._entity, fileType });

        break;
      case Entity.IDS.SHIP:
        data = await ShipService.generateCard({ entity: this._entity, fileType });
        cdn = new ShipCard();

        // delete and bust cache
        await cdn.purge(this._entity);

        // upload new image
        await cdn.upload({ contentType, data, doc: this._entity, fileType });

        break;
      default:
        throw new Error('Invalid entity type');
    }
  }
}

module.exports = NftImage;
