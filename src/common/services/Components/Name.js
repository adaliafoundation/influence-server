const mongoose = require('mongoose');
const Entity = require('@common/lib/Entity');
const ComponentService = require('./Component');

class NameComponentService extends ComponentService {
  static findByRoster(roster = [], { lean = true } = {}) {
    const rosterUuids = roster.map((id) => Entity.Crewmate(id).uuid);
    return mongoose.model('NameComponent').find({ 'entity.uuid': { $in: rosterUuids } }).lean(lean);
  }
}

module.exports = NameComponentService;
