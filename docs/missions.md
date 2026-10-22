# Missions API (SDK 2.8.0)

The server indexes persistent Dispatcher mission component updates and lifecycle events.
Native gameplay events trigger refreshes; they do not establish mission evidence. Clients
continue to submit acceptance, observation, validation and reward claims on-chain.

## Colonization summary

`GET /v2/missions/colonization/:asteroidId`

Returns `campaign`, `active`, the asteroid `subject`, `owner`, immutable `colonizer`,
`enrolled`, `canEnroll`, `recipient`, `progress` and the five `missions`.

- `canEnroll` means the indexed Starknet NFT owner can enroll an unscanned asteroid.
- `canAccept` for later missions requires the original colonizer to still own the NFT
  and mission 0 to be completed. Later branches are independent.
- `claimable` is readiness for the returned recipient, not authorization for the HTTP
  caller. The submitting account must be the original colonizer and current NFT owner.
- `claimBlockedReason` distinguishes unpaid incomplete missions, ownership changes,
  already-paid rewards and a nonoperational capstone.
- `rewardMicroSway` comes from indexed reward storage, not a duplicated reward table.
- `progress.earned` contains historical branch evidence. `selectedBuildings` includes
  readiness and failure reasons for the selected habitat, spaceport and marketplace.
  Capstone readiness checks current location, type, operational status and exact Built
  and Used fingerprints from retained Cairo component data.

A completed capstone can become unclaimable. Historical branch rewards survive building
removal; a newly selected qualifying building can restore an unpaid capstone. Selling the
NFT does not transfer the colonizer entitlement. All values are indexed snapshots and can
lag chain state; claims remain enforced by the contract, including treasury funding.

## Observer candidate discovery

`GET /v2/missions/observation-candidates?system=FillBuyOrder&targetUuid=...&crewId=...`

Returns `{ system, target, candidates: [{ campaign, subject, mission }] }` for use with
`MissionObservation.observeMissionAction` or `getObservedSystemCalls` in SDK 2.8.0.
`crewId` is optional and identifies the native caller crew (the buyer for FillSellOrder).
Omitting it discovers colony candidates only. The server resolves colony enrollment from
the target building's indexed asteroid, regardless of the acting crew's ownership.

| System | `targetUuid` | Additional query |
| --- | --- | --- |
| ConstructionPlan | Lot | `buildingType` required |
| ConstructionStart / ConstructionFinish | Building | |
| SampleDepositStart | Lot | |
| SampleDepositFinish | Deposit | |
| ExtractResourceStart / ExtractResourceFinish | Extractor building | |
| ProcessProductsStart / ProcessProductsFinish | Processor building | |
| SendDelivery | Origin entity | |
| ReceiveDelivery | Delivery | |
| ResupplyFood | Origin entity | |
| FillBuyOrder / FillSellOrder | Exchange building | |
| ScanSurfaceStart / ScanSurfaceFinish | Asteroid | |
| StationCrew | Destination habitat | |
| DockShip | Destination spaceport | |

Candidate discovery nominates missions by indexed enrollment, action and building type.
It deliberately includes unaccepted later missions and shared storage/production-chain
missions, including mission 7 when construction consumes final products. It is not a transaction simulator: calldata, minimum quantities, crew control,
current action fingerprints, caller identity and native authorization still need to pass
contract checks. Existing starter binding endpoints can inspect pending action evidence.
In particular, scan actions must be submitted by the original colonizer. Buy cancellation
shares an entrypoint with fills but cannot earn commerce evidence.

Clients must use the exact native target and crew when requesting candidates. Build
`begin_observation → native execution/payment calls → end_observation` using the SDK;
keep Escrow/SWAY payment mechanisms intact and supply their correct expected caller.
Do not call the observer helper with an empty candidate list. Ordinary unobserved gameplay
remains possible but cannot retroactively earn evidence.

For multicalls that enroll or finish a scan and then start another action before the
indexer sees the first call, construct the later assignments from that planned transaction
state rather than relying solely on indexed discovery. Scan completion followed by
construction start may have equal timestamps. Use a separate observation group per action.

A nominated mission is validated by the observer. Other accepted missions can be refreshed
with `MissionValidate(assignment, [])`; acceptance also validates previously earned evidence.
The server does not submit validation transactions or sign attestations.

## Refresh and deployment

Clients should refetch colony summaries/candidates on asteroid room updates. Mission cells,
scan state, buildings, building locations and NFT transfers notify those rooms. Campaign
configuration, definition and reward changes broadcast refreshes.

No mission storage migration is required. Reward lookups use canonical `pathKey` values, so
cells indexed before SDK 2.8.0 remain readable even if their namespace metadata is `Unknown`.
The existing generic campaign/subject/evidence endpoints and starter endpoints remain available.

Sepolia is configured separately. Mainnet deployment must coordinate the current Dispatcher
observation ABI, observer and pinned campaign implementations with the SDK/client rollout.
