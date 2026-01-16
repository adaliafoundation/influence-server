const { Schema } = require('mongoose');
const Entity = require('@common/lib/Entity');

const preSave = function () {
  if ((this.id && this.label && !this.uuid) || (this.uuid && !this.id && !this.label)) {
    const { id, label, uuid } = new Entity(this);
    this.set('id', id);
    this.set('label', label);
    this.set('uuid', uuid);
  }
};

const preValidate = function () {
  if ((this.id && this.label) || this.uuid) {
    const { id, label, uuid } = new Entity(this);
    this.set('id', id);
    this.set('label', label);
    this.set('uuid', uuid);
  } else {
    this.set('id', null);
    this.set('label', null);
    this.set('uuid', null);
  }
};

const schema = new Schema({
  id: {
    type: Number,
    default() {
      return (this.uuid) ? Entity.fromUuid(this.uuid).id : null;
    }
  },
  label: {
    type: Number,
    default() {
      return (this.uuid) ? Entity.fromUuid(this.uuid).label : null;
    }
  },
  uuid: {
    type: String,
    match: /^0x[0-9a-f]*$/i,
    default() {
      return (this.id && this.label) ? Entity.fromIdAndLabel(this.id, this.label).uuid : null;
    },
    get(v) { // not sure if this is needed
      return (!v && this.id && this.label) ? Entity.fromIdAndLabel(this.id, this.label).uuid : v;
    }
  }
}, { _id: false, __type: 'Entity' });

schema
  .pre('validate', preValidate)
  .pre('save', preSave);

module.exports = schema;
