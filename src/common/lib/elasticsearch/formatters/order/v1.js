const { omit } = require('lodash');
const { ComponentService } = require('@common/services');
const logger = require('@common/lib/logger');

const v1 = async function (indexItemDoc) {
  const orderCompDoc = await ComponentService.findOne('Order', indexItemDoc.identifier, { lean: true });

  if (!orderCompDoc) {
    logger.warn(`No OrderComponent found for ${JSON.stringify(indexItemDoc.identifier)}`);
    return null;
  }

  const locationDoc = await ComponentService.findOneByEntity('Location', orderCompDoc.entity);

  const formatted = omit(orderCompDoc, ['__v', '_id', 'entities', 'event']);

  if (locationDoc?.locations) {
    Object.assign(formatted, { locations: [...locationDoc.locations, orderCompDoc.entity] });
  }

  return {
    _id: orderCompDoc._id.toString(),
    _index: 'order_v1',
    formatted
  };
};

module.exports = v1;
