// Mapping of notification to notification type to notification model
const {
  CrewReadyNotificationFormatter,
  DirectMessageNotificationFormatter,
  LeaseExpirationNotificationFormatter,
  ResolvableNotificationFormatter
} = require('./formatters');

// Mapping of model descriminator to notification type and formatter
const config = {
  CrewReadyNotification: {
    type: 'CREW',
    formatter: CrewReadyNotificationFormatter
  },
  DirectMessageNotification: {
    type: 'DIRECT_MESSAGE',
    formatter: DirectMessageNotificationFormatter
  },
  ConstructionNotification: {
    type: 'TASK',
    formatter: ResolvableNotificationFormatter
  },
  DeliveryNotification: {
    type: 'TASK',
    formatter: ResolvableNotificationFormatter
  },
  LeaseExpirationNotification: {
    type: 'LEASE',
    formatter: LeaseExpirationNotificationFormatter
  },
  MaterialProcessingNotification: {
    type: 'TASK',
    formatter: ResolvableNotificationFormatter
  },
  ResourceExtractionNotification: {
    type: 'TASK',
    formatter: ResolvableNotificationFormatter
  },
  ResourceScanNotification: {
    type: 'TASK',
    formatter: ResolvableNotificationFormatter
  },
  SamplingDepositNotification: {
    type: 'TASK',
    formatter: ResolvableNotificationFormatter
  },
  ShipAssemblyNotification: {
    type: 'TASK',
    formatter: ResolvableNotificationFormatter
  },
  SurfaceScanNotification: {
    type: 'TASK',
    formatter: ResolvableNotificationFormatter
  },
  TransitNotification: {
    type: 'TASK',
    formatter: ResolvableNotificationFormatter
  }
};

class NotificationConfig {
  static getByDocument(value) {
    return config[(value.__t || value)];
  }

  static getByModel(value) {
    return config[value];
  }
}

module.exports = NotificationConfig;
