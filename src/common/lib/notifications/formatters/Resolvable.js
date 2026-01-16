const { Building, Entity, Product, Process, Ship } = require('@influenceth/sdk');
const { EntityService } = require('@common/services');
const {
  asteroidName,
  buildingName,
  crewName,
  deepLink,
  entityLink,
  entityName,
  shipName } = require('./utils');
const NotificationFormatter = require('./Formatter');

class ResolvableNotificationFormatter extends NotificationFormatter {
  async format() {
    // hydrate the activity
    await this._notification.populate('activity');

    const { activity } = this._notification.toJSON();
    const name = activity.event?.name || activity.event?.event;
    const returnValues = activity.event?.returnValues || {};

    // need to "hydrate" the entities
    const entities = (activity.entities?.length > 0)
      ? await Promise.all(activity.entities.map((e) => EntityService.getEntity({
        uuid: e.uuid,
        format: true
      }))) : [];

    // Locate the caller crew entity
    const callerCrew = entities.find((e) => e.label === Entity.IDS.CREW && e.id === returnValues.callerCrew?.id);

    let data;

    switch (name) {
      case 'ConstructionStarted': {
        const building = entities.find((e) => e.label === Entity.IDS.BUILDING);
        const buildingType = Building.getType(building?.Building?.buildingType)?.name || 'building';
        data = {
          body: `${crewName(callerCrew)}'s new ${buildingType} construction is now ready for completion.`,
          crewId: callerCrew.id,
          title: `${buildingName(building, `New ${buildingType}`)} is Ready`,
          url: entityLink(building, { query: { crewId: callerCrew.id } })
        };
        break;
      }

      // TODO: the finish_time only applies to when in flight, so don't send otherwise
      //  (only send third-party notification)
      // case 'CrewEjected': {
      //   const ejectedCrew = entities.find((e) => e.label === Entity.IDS.CREW && e.id
      //       === returnValues.ejectedCrew?.id);
      //   return {
      //     body: `${crewName(ejectedCrew)}'s escape module is now ready to initiate flight completion.`,
      //     crewId: ejectedCrew.id,
      //     title: 'Ejected Crew is Arriving',
      //     url: entityLink(ejectedCrew)
      //   };
      // }

      // NOTE: this will almost always be redundant to a "crewReady" notification
      // case 'CrewStationed':
      // case 'CrewStationedV1': {
      //   const station = entities.find((e) => e.label === Entity.IDS.BUILDING || e.label === Entity.IDS.SHIP);
      //   const stationType = station.label === Entity.IDS.BUILDING
      //     ? `in habitat ${buildingName(station)}`
      //     : `aboard ${shipName(station)}`;
      //   data = {
      //     crewId: callerCrew.id,
      //     body: `${crewName(callerCrew)} has successfully restationed ${stationType}.`,
      //     title: 'Crew has Arrived',
      //     url: entityLink(station)
      //   };
      //   break;
      // }

      case 'DeliverySent': {
        const firstProductId = returnValues.products[0].product;
        const otherProductsTally = returnValues.products.length - 1;
        const destination = entities.find((e) => e.label === returnValues.dest?.label
          && e.id === returnValues.dest?.id);
        data = {
          crewId: callerCrew.id,
          body: `Delivery of ${Product.TYPES[firstProductId]?.name || 'Product'}`
            + `${otherProductsTally > 0
              ? ` and ${otherProductsTally} other product${otherProductsTally > 1 ? 's' : ''}`
              : ''}`
            + ` is now ready to be received at ${entityName(destination)}.`,
          title: 'Surface Transfer Ready',
          url: entityLink(destination, { query: { crewId: callerCrew.id } })
        };
        break;
      }

      case 'MaterialProcessingStarted':
      case 'MaterialProcessingStartedV1': {
        const processor = entities.find((e) => e.label === Entity.IDS.BUILDING && e.id === returnValues.processor?.id);
        const processorType = Building.getType(processor?.Building?.buildingType)?.name || 'Processor';
        const process = Process.getType(returnValues.process)?.name || 'Process';
        data = {
          crewId: callerCrew.id,
          body: `${process} is now ready for completion at ${buildingName(processor)}.`,
          title: `${processorType} Output is Ready`,
          url: entityLink(processor, { query: { crewId: callerCrew.id } })
        };
        break;
      }

      case 'ResourceExtractionStarted': {
        const extractor = entities.find((e) => e.label === Entity.IDS.BUILDING && e.id === returnValues.extractor?.id);
        const resourceName = Product.TYPES[returnValues.resource]?.name || 'Resource';
        data = {
          crewId: callerCrew.id,
          body: `${crewName(callerCrew)}'s extraction of ${resourceName} is now ready for completion`
          + ` at ${buildingName(extractor)}.`,
          title: `${resourceName} Extraction is Ready`,
          url: entityLink(extractor, { query: { crewId: callerCrew.id } })
        };
        break;
      }

      case 'ResourceScanStarted': {
        const asteroid = entities.find((e) => e.label === returnValues.asteroid?.label
          && e.id === returnValues.asteroid?.id);
        data = {
          crewId: callerCrew.id,
          body: `${crewName(callerCrew)}'s surface scan of ${asteroidName(asteroid)} is now ready for analysis.`,
          title: 'Orbital Scan Results Ready',
          url: entityLink(asteroid, { query: { crewId: callerCrew.id } })
        };
        break;
      }

      case 'SamplingDepositStarted':
      case 'SamplingDepositStartedV1': {
        const resource = Product.TYPES[returnValues.resource]?.name || 'Resource';
        data = {
          crewId: callerCrew.id,
          body: `${crewName(callerCrew)}'s ${resource} core sample${returnValues.improving ? ' improvement' : ' '} `
            + 'is now ready for analysis.',
          title: 'Core Sample Results Ready',
          url: entityLink(returnValues.lot, { query: { crewId: callerCrew.id } })
        };
        break;
      }

      case 'ShipAssemblyFinished': {
        const ship = entities.find((e) => e.label === Entity.IDS.SHIP);
        const shipType = Ship.TYPES[returnValues.shipType]?.name || 'Ship';
        data = {
          crewId: callerCrew.id,
          body: `${shipName(ship)} has been delivered and is now ready for use.`,
          title: `${shipName(ship, `New ${shipType}`)} is Ready`,
          url: entityLink(returnValues.destination, { query: { crewId: callerCrew.id } })
        };
        break;
      }

      // case 'ShipDocked': { // TODO: only if takes time
      //   const ship = entities.find((e) => e.label === Entity.IDS.SHIP);
      //   const dock = entities.find((e) => e.label === Entity.IDS.BUILDING);
      //   const lot = entities.find((e) => e.label === Entity.IDS.LOT);
      //   data = {
      //     crewId: callerCrew.id,
      //     body: `${shipName(ship)} has successfully ${dock ? 'docked' : 'landed'} at `
      //       + `${dock ? buildingName(dock) : lotName(lot)} and is now ready.`,
      //     title: `${shipName(ship)} has ${dock ? 'Docked' : 'Landed'}`,
      //     url: entityLink(dock || lot)
      //   };
      //   break;
      // }

      // case 'ShipUndocked': { // TODO: only if takes time
      //   const asteroid = entities.find((e) => e.label === Entity.IDS.ASTEROID);
      //   const ship = entities.find((e) => e.label === Entity.IDS.SHIP);
      //   data = {
      //     crewId: callerCrew.id,
      //     body: `${shipName(ship)} has successfully launched into orbit around`
      //     + ` ${asteroidName(asteroid)} and is now ready.`,
      //     title: `${shipName(ship)} is in Orbit`,
      //     url: entityLink(asteroid)
      //   };
      //   break;
      // }

      case 'ShipAssemblyStarted':
      case 'ShipAssemblyStartedV1': {
        const ship = entities.find((e) => e.label === Entity.IDS.SHIP);
        const shipType = Ship.TYPES[returnValues.shipType]?.name || 'Ship';
        data = {
          crewId: callerCrew.id,
          body: `${crewName(callerCrew)}'s new ${shipType} is now assembled and ready for delivery.`,
          title: `${shipName(ship, `New ${shipType}`)} is Assembled`,
          url: deepLink(returnValues.dryDock, { query: { crewId: callerCrew.id } })
        };
        break;
      }

      case 'SurfaceScanStarted': {
        const asteroid = entities.find((e) => e.label === returnValues.asteroid?.label
          && e.id === returnValues.asteroid?.id);
        data = {
          crewId: callerCrew.id,
          body: `${crewName(callerCrew)}'s long-range surface scan of ${asteroidName(asteroid)} `
            + 'is now ready for analysis.',
          title: 'Long-Range Scan Results Ready',
          url: entityLink(asteroid, { query: { crewId: callerCrew.id } })
        };
        break;
      }

      case 'TransitStarted': {
        const dest = entities.find((e) => e.label === returnValues.destination?.label
          && e.id === returnValues.destination?.id);
        const ship = entities.find((e) => e.label === Entity.IDS.SHIP);
        data = {
          crewId: callerCrew.id,
          body: `${shipName(ship)} is in its final approach to ${asteroidName(dest)} `
          + `and ready for ${crewName(callerCrew)} to initiate flight completion.`,
          title: `${shipName(ship)} has Arrived`,
          url: entityLink(dest, { query: { crewId: callerCrew.id } })
        };
        break;
      }

      default:
        throw new Error(`No handler for for ${name}`);
    }

    return data;
  }
}

module.exports = ResolvableNotificationFormatter;
