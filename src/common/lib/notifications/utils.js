const mongoose = require('mongoose');
const { castArray, compact } = require('lodash');
const Entity = require('@common/lib/Entity');

const NOTIICATION_TYPES = [
  'CREW',
  'LEASE',
  'TASK'
];

const getCrewToNotify = async function (crew, notificationType) {
  if (!crew) throw new Error('crew is required');
  if (!NOTIICATION_TYPES.includes(notificationType)) throw new Error('notificationType is required');

  const results = await Promise.all(castArray(crew).map(async (entity) => {
    const crewEntity = (entity.uuid) ? entity : Entity.toEntity(entity);
    const crewCompDoc = await mongoose.model('CrewComponent').findOneByEntity(crewEntity);

    if (!crewCompDoc?.delegatedTo) return null;

    const userDoc = await mongoose.model('User').findByAddress(crewCompDoc.delegatedTo);
    if (!userDoc?.email) return null;

    return (userDoc.notificationSubscriptionEnabled(notificationType)) ? crewEntity : null;
  }));

  return compact(results);
};

module.exports = {
  getCrewToNotify
};
