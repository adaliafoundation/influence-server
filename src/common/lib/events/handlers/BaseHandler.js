const { invert, merge, upperFirst } = require('lodash');
const eventEmitter = require('@common/lib/sio/emitter');
const Entity = require('@common/lib/Entity');

class BaseHandler {
  constructor(eventDoc) {
    this.eventDoc = eventDoc;
    this.messages = {
      _messages: [],
      push(message) {
        const exists = this._messages.find(({ to }) => to === message.to);
        if (!exists) this._messages.push(message);
      },
      map(args) {
        return this._messages.map(args);
      }
    };
  }

  addAddressRoomMessage(address, props = {}) {
    this.messages.push({ to: address, ...props });
  }

  addAsteroidRoomMessage(asteroid, props = {}) {
    this.messages.push({ to: `Asteroid::${asteroid.id}`, ...props });
  }

  addCrewRoomMessage(crew, props = {}) {
    this.messages.push({ to: `Crew::${crew.id}`, ...props });
  }

  addCrewmateRoomMessage(crewmate, props = {}) {
    this.messages.push({ to: `Crewmate::${crewmate.id}`, ...props });
  }

  addShipRoomMessage(ship, props = {}) {
    this.messages.push({ to: `Ship::${ship.id}`, ...props });
  }

  getRoomFromEntity(entity) {
    const { id, label } = Entity.toEntity(entity);
    const key = invert(Entity.IDS)[label];
    if (!key) throw new Error('Entity label not found');
    return `${upperFirst(key.toLowerCase())}::${id}`;
  }

  async emitSocketEvents() {
    await Promise.all(this.messages.map((props) => {
      const message = merge({}, this.formatWebSocketMessage(), props);
      if (message.to) Object.assign(message, { room: message.to });
      return (message.to) ? eventEmitter.emitTo(message) : eventEmitter.broadcast(message);
    }));
  }

  finalizeEvent() {
    this.eventDoc.set('lastProcessed', new Date());
    return this.eventDoc.save();
  }

  formatWebSocketMessage() {
    return {
      eventName: this.eventDoc.event,
      type: this.eventDoc.event,
      body: { event: this.eventDoc.toJSON() }
    };
  }

  async processEvent() {
    throw new Error('Must implement in sub class');
  }
}

module.exports = BaseHandler;
