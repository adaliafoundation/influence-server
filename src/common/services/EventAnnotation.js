const mongoose = require('mongoose');
const Joi = require('joi');
const { Address } = require('@influenceth/sdk');
const Entity = require('@common/lib/Entity');
const { isObject } = require('lodash');
const { InfuraIpfs } = require('@common/lib/Ipfs');

class EventAnnotationService {
  static MAX_ANNOTATION_SIZE = 1024; // In Bytes

  static MIN_ANNOTATION_SIZE = 52; // In Bytes

  static async findOrCreate({
    annotation,
    caller,
    callerCrew,
    contentHash,
    event: { transactionHash, logIndex } = {},
    pin = false }) {
    if (!caller) throw new Error('EventAnnotationService::findOrCreate: Missing required parameter: caller');
    const _callerCrew = Entity.toEntity(callerCrew);
    let _contentHash = contentHash;
    const _caller = Address.toStandard(caller, 'starknet');

    if (!_contentHash && annotation) {
      this.validate(annotation);
      _contentHash = await InfuraIpfs.hashData(annotation);
    }

    // Find EventAnnotation event (note, this is not the event being annotated)
    // This is to confirm that the `EventAnnotated` exists and has been processed
    const annotationEvent = await mongoose.model('Starknet').findOne({
      event: 'EventAnnotated',
      'returnValues.callerCrew.id': _callerCrew.id,
      'returnValues.contentHash': _contentHash,
      'returnValues.transactionHash': transactionHash,
      'returnValues.logIndex': Number(logIndex),
      'returnValues.caller': _caller
    });

    if (!annotationEvent) {
      throw new Error('EventAnnotationService::findOrCreate: EventAnnotated event not found.');
    }

    // If content is provided, validate and upload
    if (annotation) {
      this.validate(annotation);
      const ipfs = new InfuraIpfs();
      const result = await ipfs.addData(annotation, { pin });
      _contentHash = result.hash;
    }

    const filter = {
      address: _caller,
      crew: annotationEvent.returnValues.callerCrew.id,
      'ipfs.hash': annotationEvent.returnValues.contentHash,
      'annotated.transactionHash': annotationEvent.returnValues.transactionHash,
      'annotated.logIndex': annotationEvent.returnValues.logIndex
    };

    const update = {
      address: _caller,
      annotated: { transactionHash, logIndex },
      crew: annotationEvent.returnValues.callerCrew.id,
      ipfs: { hash: annotationEvent.returnValues.contentHash, service: 'infura', pinned: pin }
    };

    return mongoose.model('EventAnnotation').findOneAndUpdate(filter, update, { upsert: true, new: true });
  }

  static findByEvent(event, { lean = true } = {}) {
    const { transactionHash, logIndex } = event;

    return mongoose.model('EventAnnotation').find({
      'annotated.transactionHash': transactionHash,
      'annotated.logIndex': Number(logIndex)
    })
      .select('-_id -__v')
      .lean(lean);
  }

  static hashData(data) {
    return InfuraIpfs.hashData(data);
  }

  static validate(data) {
    const validationSchema = Joi.object({
      content: Joi.string()
        .trim()
        .min(1)
        .required(),
      type: Joi.string()
        .pattern(/^EventAnnotation$/)
        .required(),
      version: Joi.number()
        .min(1)
        .required()
    });
    const _data = (isObject(data)) ? data : JSON.parse(data);

    // validate size
    const size = Buffer.byteLength(JSON.stringify(_data), 'utf8');
    if (size > this.MAX_ANNOTATION_SIZE || size < this.MIN_ANNOTATION_SIZE) {
      throw new Error(`EventAnnotationService::validate: Invalid size: ${size}`);
    }

    // validate structure
    const validationResult = validationSchema.validate(_data);
    if (validationResult.error) {
      throw new Error(`EventAnnotationService::validate: Invalid structure: ${validationResult.error.message}`);
    }
  }
}

module.exports = EventAnnotationService;
