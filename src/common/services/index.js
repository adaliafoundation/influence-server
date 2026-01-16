const ActivityService = require('./Activity');
const ApiKeyService = require('./ApiKey');
const ArgentService = require('./Argent');
const AsteroidSaleService = require('./AsteroidSale');
const AsteroidService = require('./Asteroid');
const AuthService = require('./Auth');
const BuildingService = require('./Building');
const ComponentService = require('./Components/Component');
const ConstantService = require('./Constant');
const CrewService = require('./Crew');
const CrewmateService = require('./Crewmate');
const CrossingService = require('./Crossing');
const DirectMessageService = require('./DirectMessage');
const ElasticSearchService = require('./ElasticSearch');
const EntityService = require('./Entity');
const EntropyService = require('./Entropy');
const EthereumEventService = require('./Event/Ethereum');
const EventAnnotationService = require('./EventAnnotation');
const EventService = require('./Event');
const LocationComponentService = require('./Components/Location');
const LotService = require('./Lot');
const MetadataService = require('./Metadata');
const NameComponentService = require('./Components/Name');
const NftComponentService = require('./Components/Nft');
const NotificationServices = require('./Notifications');
const OrderComponentService = require('./Components/Order');
const PackedLotDataService = require('./PackedData/LotData');
const PrepaidMerklePolicyService = require('./Components/Policies/PrepaidMerkle');
const ReferralService = require('./Referral');
const ShipService = require('./Ship');
const StarknetEventService = require('./Event/Starknet');
const SwayClaimService = require('./SwayClaim');
const SwayCrossingService = require('./SwayCrossing');
const UserService = require('./User');

module.exports = {
  ActivityService,
  ApiKeyService,
  ArgentService,
  AsteroidSaleService,
  AsteroidService,
  AuthService,
  BuildingService,
  ComponentService,
  ConstantService,
  CrewmateService,
  CrewService,
  CrossingService,
  DirectMessageService,
  ElasticSearchService,
  EntityService,
  EntropyService,
  EthereumEventService,
  EventAnnotationService,
  EventService,
  LocationComponentService,
  LotService,
  MetadataService,
  NameComponentService,
  NftComponentService,
  OrderComponentService,
  PackedLotDataService,
  PrepaidMerklePolicyService,
  ReferralService,
  ShipService,
  StarknetEventService,
  SwayClaimService,
  SwayCrossingService,
  UserService,
  ...NotificationServices
};
