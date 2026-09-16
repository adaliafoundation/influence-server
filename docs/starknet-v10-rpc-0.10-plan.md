Starknet.js v10 / RPC 0.10 migration plan — investigated 2026-09-16

Recommendation: upgrade the direct Starknet.js dependency from locked 8.9.2 to 10.8.0, and migrate the API and event-indexing endpoints to a verified RPC 0.10 revision. The measured baseline endpoint is RPC 0.8.1, which v10 does not support. Deploy the server SDK upgrade and API RPC endpoint switch together; the custom indexer endpoint can be managed separately. The scope is this server; wallet/client compatibility needs a separate check before coordinated production rollout.

“v10” here means Starknet.js, not the Starknet network protocol. The official release page identifies 10.8.0 (September 10) as latest stable, adding RPC 0.10.4 support. RPC 0.10 support started in Starknet.js v9; v10 also changes Account from Provider inheritance to composition. Node >=22 and CommonJS remain supported, matching this repository's Node 22.22.1 and require() usage. Sources: [10.8.0 release](https://github.com/starknet-io/starknet.js/releases/tag/v10.8.0), [10.0.0 changes](https://github.com/starknet-io/starknet.js/releases/tag/v10.0.0), [published package metadata](https://registry.npmjs.org/starknet/10.8.0).

There is good reason to schedule the upgrade now, but this investigation did not establish a provider-specific shutdown date for our current endpoints. Starknet's published policy promises RPC versions at least one year of support after introduction; that is not an exact retirement schedule. Verify the actual deployed versions and provider notices before assigning a deadline. [Official deprecation policy](https://community.starknet.io/t/notice-of-deprectation-for-rpc-0-6-and-0-7/116074).

The original integration has two independent paths (the implementation status below supersedes this inventory):

| Area | Current implementation | Migration impact |
| --- | --- | --- |
| SDK integration | `src/common/lib/starknet/client.js`; async provider factory, object Account constructor, Contract constructor fallback | Use documented v10 APIs directly; remove feature detection and catch-all positional fallback. |
| API RPC | `STARKNET_RPC_PROVIDER` | Auth, Banxa and paymaster deployment checks, faucet, starter-pack and crewmate grant submissions. |
| Indexer RPC | `src/common/lib/starknet/providers/rpc.js`; Axios JSON-RPC | SDK upgrade does not migrate this path. `STARKNET_EVENT_RETRIEVER_RPC_PROVIDER` overrides the API endpoint; retriever and auditor share it. |
| Event normalization | `models/Event.js` and `providers/rpc.js` | Already reads `event_index` and `transaction_index`; older responses use inferred indices. |
| Finality | Numbered block retrieval; auditor requests `l1_accepted` | Preserve current confirmed-block processing. No need to introduce pre-confirmed ingestion. |
| Transitive dependency | `@influenceth/sdk` 2.4.4 includes Starknet.js 5.24.3 | Direct dependency upgrade will not remove it. Check address/hash/calldata compatibility; do not force a major override into the SDK. |

The most consequential risk is event identity. RPC 0.10 defines `event_index` as the index within the complete transaction. Our older-response fallback counts the filtered events returned by tracked-address queries, which can omit other contracts' events or concatenate addresses in a different order. Both Mongo uniqueness and auditor identity include `(event, transactionHash, logIndex)`. Switching to canonical indices can therefore change historical identities. This is a code-derived risk, not evidence that production data is currently affected. [RPC 0.10.4 schema](https://github.com/starkware-libs/starknet-specs/blob/v0.10.4/api/starknet_api_openrpc.json).

The same schema defines an optional string continuation token. `_getEvents` currently sends `continuation_token: null` on the first page; omit it instead. Batch first pages already omit it. The schema also retains `latest`, `l1_accepted`, and `pre_confirmed`; the production retriever uses numbered blocks, so the v9 pending-tag migration does not require a retriever redesign. [SDK v9 migration guide](https://starknet-js.com/docs/guides/migrate/).

Proposed implementation and rollout:

1. **Establish endpoint and data baselines.** Query `starknet_specVersion` and `starknet_chainId` for API and indexer endpoints in each deployed environment, without logging credentials. Confirm provider support for the intended 0.10 revision, historical data, batch requests, pagination and `l1_accepted`. Compare a fixed historical block range through old and new endpoints, including transactions emitting from several contracts and paginated results. Compare canonical indices against stored events and full receipts. Exit condition: exact target revision and any identity discrepancies are documented.

2. **Upgrade the SDK in one focused PR.** Pin `starknet` to 10.8.0 and regenerate the lockfile. Keep the shared client factory, using `RpcProvider.create`, object Account and object Contract constructors directly. The v10 factory detects the endpoint's spec version and supports 0.9 and 0.10, allowing a staged rollout if our current endpoint is 0.9. Reject unsupported/missing endpoint configuration clearly. Existing account consumers call `execute` or pass the account to Contract; no direct inherited provider calls were found. Validate the faucet Contract/account interaction explicitly. Avoid broad refactors, ESM conversion or SDK dependency overrides. [Versioned provider implementation](https://github.com/starknet-io/starknet.js/blob/v10.8.0/src/provider/rpc.ts).

3. **Validate service behavior against the real v10 boundary.** Existing service tests frequently stub the client factory, so add coverage that constructs real v10 objects with mocked RPC transport. Cover grant execution, nonce/fee estimation and v3 submission, faucet transfer calldata, typed-data hashes, ordinary/Argent/Cartridge login signatures, and deployed/undeployed wallet checks. Auth currently treats every `getClassAt` failure as undeployed; distinguish contract-not-found from transport and protocol errors so RPC failures cannot bypass signature verification. Reuse a structured RPC error classifier for Auth, Banxa and paymaster checks where appropriate. Test existing hash, uint256 and address utilities against known fixtures. AVNU is a separate HTTP paymaster proxy; confirm its existing request/response contract without assuming SDK paymaster changes update it.

4. **Make the raw RPC path spec-compliant in a second focused PR.** Omit absent continuation tokens and add realistic 0.10 fixtures. Test nonzero/sparse canonical event indices, multiple addresses within one transaction, out-of-order batch responses, pagination, block timestamps/status, receipt parsing and `l1_accepted`. Preserve canonical indices, including zero. Keep older-response behavior only for the explicitly supported rollout version; do not add speculative compatibility branches. Run retriever/auditor/reorg tests and verify checkpoint advancement on success and preservation on failure.

5. **Resolve any historical identity mismatch before replay.** If baseline comparisons show differences, prepare a bounded reconciliation procedure on a database copy, including dependent activities and annotations keyed by log index. Verify processor idempotency and notification effects before reprocessing. Do not reset checkpoints or launch a full historical replay by default: `updateOrCreateMany` resets `lastProcessed`, and the auditor can purge activities and trigger processing. If comparisons match, no data migration is needed.

6. **Stage, then cut over.** Run lint, relevant service/indexer tests, the complete suite and deployment checks on Node 22. Deploy to Sepolia and exercise login, deployment checks, sponsored flow, faucet and both grant paths through confirmation events. Compare old/new indexer results in an isolated read-only run. Deploy v10 against the existing endpoint first only if its version is supported and tested; then change the API and indexer endpoints in controlled steps. Monitor RPC errors, authentication errors, grant failures, retrieval/audit lag and mismatch counts. Record image/config versions and checkpoints. Roll back to the previous tested image/endpoint pair if necessary; after any canonical-index data changes, endpoint rollback also requires the validated reconciliation strategy.

Estimated effort: 3–5 engineering days for implementation, tests and staging, plus an observation window, assuming usable endpoints and no historical data repair. This is a planning estimate; endpoint availability, cross-repository client work and reconciliation can extend it.

Initial investigation used source, lockfile, existing tests, official release notes, package metadata and the versioned RPC schema. Subsequent implementation and user-run live audits are recorded below. No on-chain transactions or deployment changes have been performed by the agent.

Follow-up regression test (2026-09-16): `test/src/common/lib/starknet/providers/historicalIdentity.spec.js` now exercises the current RPC provider using the existing synthetic event, block and full-receipt fixtures for block 847108, transaction `0x036de32a8ec12bfc6df831a9a5d9a8b8168a6470c0695df8e4a3ea511380dcd1`. RPC 0.10 responses are constructed from full-receipt positions; they are not captured from a live 0.10 endpoint. The synthetic fixture illustrates that 20 of 24 tracked events can change identity under the legacy filtered-event fallback. The user confirmed this fixture is fake; it is not evidence about any real historical transaction. The full receipt contains 31 events, including other contracts' emissions and repeated identical payloads.

Four passing regression cases verify receipt-derived canonical indices, detection of the synthetic index discrepancy by the auditor, unchanged identities before the first gap, and canonical identities across pagination and reversed multi-address batch responses. Passing these tests means the drift is correctly detected, not that migration is safe or production history has been reconciled. No production normalization behavior was changed. Live endpoint and stored-data comparisons remain a rollout requirement.

Run the isolated tests on the repository's Node version without database or network services:

```sh
NODE_ENV=test LOG_LEVEL=test ./node_modules/.bin/mocha --no-config --require module-alias/register test/src/common/lib/starknet/providers/historicalIdentity.spec.js
```

Validation: all four cases passed on Node 22.22.1; the new test file passed ESLint.

Implementation and real-data validation (2026-09-16):

- User-run read-only audits compared production Mongo records, baseline RPC 0.8.1 full receipts, and target RPC 0.10 getEvents responses. Blocks 219564–244564: 8 transactions / 556 events. Blocks 14937013–14962013: first 100 transactions / 540 events. All 1,096 events matched with zero mismatches, ambiguity or unverifiable results. This is bounded sample coverage, not proof for all history. No data reconciliation is currently justified by these results.
- Direct dependency pinned to Starknet.js 10.8.0 with the lockfile updated. Shared client uses v10 constructors and requires an explicit endpoint. Obsolete constructor fallbacks removed.
- Auth, Banxa and AVNU deployment checks share structured CONTRACT_NOT_FOUND classification. Auth propagates other RPC errors instead of allowing login as an undeployed account. Tests use real SDK RpcError objects.
- Raw event pagination now omits an absent continuation token. Event identity normalization and historical checkpoints remain unchanged.
- Added tests construct real v10 providers, accounts and faucet contracts with mocked transport: RPC negotiation (0.9/0.10), rejection of 0.8, signature-call serialization, structured errors, nonce/fee estimation, v3 signing/submission, and rejection before submission when fee estimation fails. A fixed pre-upgrade login typed-data hash verifies signing-payload stability.
- Validation on Node 22.22.1: 1,051 Mocha tests and 24 deployment tests passed; full ESLint passed. Service tests include existing purchase, faucet, auth, paymaster and event-processing coverage. These are local tests, not live transaction acceptance tests.

Remaining release steps:

1. Confirm exact RPC 0.10 revision and chain ID for each deployment endpoint. Set STARKNET_RPC_PROVIDER to a supported endpoint in the same release as v10. Update STARKNET_EVENT_RETRIEVER_RPC_PROVIDER if its override is configured. Do not ship v10 with the baseline 0.8.1 API endpoint.
2. Exercise Sepolia wallet login (ordinary, Argent session and Cartridge), deployed/undeployed checks, AVNU sponsorship, faucet transfer, and both purchase grants through their confirmation events using staging credentials. Validate batch event retrieval, l1_accepted and auditor progression against the intended endpoint. No staging deployment or funded transactions have been performed here.
3. Roll out with monitoring for login failures, submission failures, retriever/auditor lag and unexpected auditor repairs. Rollback must restore the previous tested image and endpoint configuration together. Do not reset or replay history without a demonstrated need.
Influence SDK follow-up completed: pinned @influenceth/sdk to the published 2.5.0 release, which depends on Starknet.js ^10.8.0. The lockfile now resolves both the server and SDK to the same Starknet.js 10.8.0 installation; the nested 5.24.3 copy was removed without an override. Revalidated with 1,051 passing application tests, 24 passing deployment tests and clean full ESLint. Staging and coordinated endpoint rollout above remain outstanding.

Exploratory audit scripts and local reports remain under Git-ignored tmp/starknet-identity-audit. Nothing has been committed or deployed.
