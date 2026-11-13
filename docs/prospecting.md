# Prospecting integration

SDK 2.9.0-rc.2 supplies the authoritative gameplay ABIs. The new handlers decode
Claim, ExtractorSlots, ProspectingOrigin, ProspectingCampaign and ProspectingCore
using those ABIs. Campaign and core paths are separate from entity UUIDs. Large
IDs, commitments, packed metadata and entropy remain decimal strings. Event order
and duplicate handling use the existing component service.

Deposit entities gain optional Claim metadata; old deposits retain their identities
and balances. Buildings expose ExtractorSlots, and lots expose ProspectingOrigin.
The Elasticsearch mappings add corresponding fields. Existing mining jobs and
legacy sampling completion continue through their unchanged handlers.

ResourceExtractionStartedV1 is normalized to the existing ResourceExtractionStarted
activity family, preserving notifications, ongoing queries and collection matching.
Baseline mode has no deposit. All four campaign events create public activities
and crew/lot notifications. These contain only data already published on chain.

Public read endpoints:

- `GET /v2/prospecting/campaigns?owner=0x...&originId=...&page=1`
- `GET /v2/prospecting/campaigns/:id` returns indexed campaign and ordered cores.

The client checks authoritative commitment/timing state through its RPC provider;
these endpoints support history/discovery and do not grant authority.

## Database preparation

Production disables automatic MongoDB index creation. Before processing the new
components, create only their indexes and apply the additive Elasticsearch mappings
using the normal environment configuration (Node 22):

```sh
node bin/create_prospecting_indexes.js
node bin/elasticsearch.js updateMapping --type deposit --version 1
node bin/elasticsearch.js updateMapping --type building --version 1
node bin/elasticsearch.js updateMapping --type lot --version 1
```

These commands preserve existing documents and indexes. Apply mappings before new
metadata is indexed so Elasticsearch does not infer types for campaign IDs. If the
environment uses a different index version, select its matching schema/version.
No legacy Deposit conversion or mass reindex is required: absence of Claim metadata
selects the default legacy rate in the SDK and contracts.

## Encrypted retention worker

`npm run private-data` starts a separate, opt-in libp2p worker. Its default listen
address is `/ip4/127.0.0.1/tcp/15179/ws`. The printed multiaddr includes the peer ID;
put that value in the client's `REACT_APP_APP_PRIVATEDATAPEERS` configuration.

The worker uses the SDK private-data protocol with Noise/Yamux and verifies each
write against the authenticated connection's public key. It retains ciphertext
and signatures under opaque record IDs. It does not retain player encryption keys,
campaign scopes, salts or plaintext observations. Reads and writes are isolated
by authenticated peer identity. Revision compare-and-swap prevents stale writers;
identical retries are idempotent. File and directory fsync complete before acknowledgment.

Configuration:

- `PRIVATE_DATA_DIRECTORY` defaults to `data/private-records`. Persist this volume,
  including `peer.seed`, across worker restarts. Run one worker per directory.
- `PRIVATE_DATA_LISTEN` and `PRIVATE_DATA_ANNOUNCE` accept comma-separated multiaddrs.
  Public browser access needs a reachable WSS endpoint/TLS proxy and a stable peer ID.
- `PRIVATE_DATA_REPLICATION_PEERS` accepts comma-separated multiaddrs of other
  independently operated stack peers, including their `/p2p/PEER_ID` suffixes.
- `PRIVATE_DATA_MAX_RECORDS` defaults to 10000; `PRIVATE_DATA_MAX_RECORDS_PER_PEER`
  defaults to 500. Payloads are limited by the SDK's 256 KiB protocol bound.

Keep the worker private until the operator configures the WSS proxy, storage volume
and capacity policy. It is not automatically started by the API or PM2 configuration.
Server-side ciphertext retention complements the client's IndexedDB journal; remote
outages do not permit a different sample or block a locally durable commitment.

## Replication between independent stacks

The browser signs a per-record authorization listing its configured retention peer
IDs. It expires after seven days and is refreshed on subsequent uploads. This
authorizes that named group to forward the owner's signed ciphertext to one another.
An operator's replication configuration alone grants no access: a receiver verifies
the owner's signature, record ID, expiry, and both sending/receiving peer identities.
Owner encryption keys never leave the browser. Authorization expiry stops forwarding;
it does not expire a claim, delete an existing backup or prevent its owner retrieving it.

For two stacks A and B, configure both multiaddrs in the browser's retention peers,
and B's multiaddr in A's `PRIVATE_DATA_REPLICATION_PEERS` (and vice versa for symmetric
replication). Each worker forwards only to the intersection of its configured peers
and the owner's signed group. Peer discovery remains explicit, rather than automatic.
The worker remains a separate process; stack deployment must provision its WSS endpoint
and persistent volume. No stack orchestrator or browser-to-browser transport is added.

The normal `/influence/private-records/1.0.0` protocol retains authenticated owner-only
reads/writes. `/influence/private-replication/1.0.0` accepts authorized signed snapshots
from group peers and stores them under the original owner's identity. A forwarding
peer cannot use the owner API to retrieve other records or invent signed revisions.

Record and forwarding authorization are saved together before acknowledgement.
Workers retry on a 15-second interval and resume the retained backlog after restart,
even with no browser connected. Acknowledgements are cached in memory, so a restart
may resend an identical revision; retries are idempotent. Old clients that supply no
authorization can still save/recover their own records but do not enable forwarding.

Replicas accept higher owner-signed revision numbers and reject older or divergent
equal revisions. This chooses a signed snapshot; it does not merge private histories
or prove ancestry between encrypted revisions. The browser still validates replay,
on-chain commitments and local conflicts before using recovered data. Direct browser
writes retain compare-and-swap. If replication advanced a peer behind the browser's
back, the browser retries only after verifying that the peer holds an exact snapshot
this device already knows; unfamiliar histories require recovery rather than overwrite.
Success at one peer is retained even if another peer is offline. The UI still reports
fully backed up only after every configured retention peer acknowledges the revision.

Tests cover real WebSocket/Noise forwarding, restarted backlog recovery, owner recovery
with the original stack offline, expired/forged authorizations, unapproved relays,
tampered records, stale/forked revisions and per-peer partial-acknowledgement recovery.

## Activation

Deploy/index this server before registering new ConstructionFinish classes: they
can emit ExtractorSlots before prospecting activation. Prepare the single verifier/adapter and
system registrations in the contracts deployment configuration, test the client
transaction flow locally, then deploy to Sepolia. ConfigureProspecting activates
the acquisition/mining changes together; call it last. Production proving-key setup
remains deferred. No deployment or activation is performed by this integration.

The proof deployment now uses one padded Groth16 circuit for 1–10 samples. Publish
and install SDK rc.2 before rebuilding containers; public component/event shapes
are unchanged. See influence-starknet’s proof build and deployment instructions.
