const { isFunction } = require('lodash');
const Entity = require('@common/lib/Entity');
const { CrewService } = require('@common/services');
const Logger = require('@common/lib/logger');

class AsteroidChatRoom {
  static roomName = 'asteroid-chat-room';

  static join(socket) {
    return socket.join(this.roomName);
  }

  static enableSendMessaging(socket, emitter) {
    socket.on('send-message', async ({ from, asteroid, message }, callback) => {
      if (isFunction(callback)) callback('send-message-received');

      if (!from || !message || !asteroid) {
        return socket.emit('send-message-failure', { message: 'Missing required parameters' });
      }

      let ownsCrew = false;
      let fromEntity;
      let asteroidEntity;

      try {
        fromEntity = new Entity(from);
      } catch (error) {
        return socket.emit('send-message-failure', { message: 'Invalid from parameter' });
      }

      try {
        asteroidEntity = new Entity(asteroid);
      } catch (error) {
        return socket.emit('send-message-failure', { message: 'Invalid asteroid parameter' });
      }

      // confirm the user controls the crew
      try {
        ownsCrew = await CrewService.isDelegatedTo({ crew: fromEntity, address: socket.auth?.decoded_token?.sub });
      } catch (error) {
        Logger.error(`Error checking crew ownership: ${error.message || error}`);
        return socket.emit('send-message-failure', {
          message: `Error checking crew ownership: ${error.message || error}`
        });
      }

      if (ownsCrew) {
        return emitter.emitTo({
          eventName: 'chat-message-received',
          to: this.roomName,
          body: {
            asteroid: asteroidEntity,
            from: fromEntity,
            message
          }
        });
      }
      return socket.emit('send-message-failure', { message: 'You do not own this crew' });
    });
  }
}

module.exports = AsteroidChatRoom;
