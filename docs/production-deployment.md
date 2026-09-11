# Production server releases and deployment

## Release an exact commit

1. Merge these changes before trying to release a commit: older commits do not contain the production target or tests.
2. In GitHub Actions choose **Release production server**, select workflow branch **`main`**, click **Run workflow**, and supply the full lowercase 40-character `commit_sha`. The commit must already belong to `main` history.
3. The workflow verifies `main` ancestry before checking out or executing that commit, runs unit/deployment tests, builds the `production` target for `linux/amd64`, and publishes a temporary candidate with an SPDX SBOM and maximum BuildKit provenance. It scans that exact digest with Grype, smoke-tests it, then waits for the `production` environment approval. The protected publication job signs it with keyless Cosign and verifies the signature before publishing release aliases.
4. Download the `production-image` artifact or copy `image@sha256:...` from the successful job summary. The job does **not** deploy, call the prerelease webhook, or promote a prerelease image.

The release tag is `ghcr.io/adaliafoundation/influence-server:production-<full-sha>`. The job refuses to replace an existing SHA release. `production` and `latest` are convenience aliases; always deploy by digest. Registry tags are mutable by registry administrators; the digest is the immutable identity. Failed jobs may leave a `candidate-...` tag, which is not a release and must not be deployed. Keep released digests and their attestations/signatures available for rollback.

### One-time server repository settings

A repository administrator must protect `main` with required PR review and status checks, restrict bypass/force pushes, and create the GitHub environment **`production`** with required reviewer approval and deployment branches restricted to **`main`**. Configure these in GitHub Settings before the first release; declaring `environment: production` in YAML does not configure protection rules. Availability of required reviewers depends on the repository visibility and GitHub plan.

Allow Actions package creation/access for `GITHUB_TOKEN`. Unit tests have only read permissions. The build job can push a candidate, the scan/smoke job has read-only package access, and only the protected publication job has signing OIDC permissions. Candidate images are uploaded before approval to permit digest-based verification; deployers must accept only successfully released, signed digests. No long-lived signing secret is needed.

Workflow dispatch must use `main`; candidate commits must be ancestors of `origin/main`. Ancestry is checked again in each job. Scan policy and smoke-test scripts come from the trusted workflow revision, not the selected release commit. Protect workflow/policy changes through review on `main`.

### Vulnerability policy

Every Critical finding blocks unless reviewed evidence establishes that the image is **not affected**. Fixable High findings also block; only verified non-applicability can exclude them. Unfixed High findings with known `not-fixed` or `wont-fix` status produce visible warnings without blocking. High findings with unknown fix status still block. Debian `wont-fix` never automatically exempts a Critical finding.

Exceptions live in `security/vulnerability-exceptions.json` and must be reviewed through a PR. Each entry requires `vulnerability`, `package`, `version`, `type`, `namespace`, `purl` (complete package URL including architecture/distro), `disposition` (`not_affected` or `accepted_risk`), `rationale`, `evidence`, `owner`, `reviewedAt` and `expiresAt`. Use UTC ISO timestamps. Entries match the exact vulnerability/package/version/ecosystem/namespace/package URL (normalizing only Debian point-release distro labels to their major release), require an explicit expiry, and must be re-reviewed after expiry. Accepted-risk entries are limited to 30 days; documented `not_affected` decisions may have a longer review period. Missing evidence or ownership, duplicates, malformed scans and expired entries fail the gate. Publication rechecks expiry after environment approval. The initial Critical applicability decisions are documented in [the production vulnerability review](../security/production-vulnerability-review.md) and remain valid through December 31, 2026 (expire at 2027-01-01T00:00:00Z). No Critical risk acceptance is permitted. Re-review these decisions when changing the runtime or its execution paths; package matching alone cannot detect application behavior changes.

All findings remain in the JSON scan artifact. A patched `tmp` version is selected for `patch-package` through an npm override; remove that override when the upstream dependency is fixed. Update the pinned Node digest and action commit pins deliberately and rerun release checks.

Before deploying, verify the digest using the workflow identity that actually ran:

```sh
cosign verify "$PRODUCTION_IMAGE" \
  --certificate-identity 'https://github.com/adaliafoundation/influence-server/.github/workflows/docker-production.yaml@refs/heads/main' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com

docker buildx imagetools inspect "$PRODUCTION_IMAGE" --format '{{json .SBOM}}'
docker buildx imagetools inspect "$PRODUCTION_IMAGE" --format '{{json .Provenance}}'
```

Check that the provenance/OCI revision identifies the requested source commit. The signature authenticates the digest, including its attached BuildKit attestations. Releases from other workflow branches are rejected.

## Stack / deployer changes

Production CI uses the `production-test` stage with MongoDB 7 test binaries (`MONGOMS_VERSION=7.0.14`). The existing `unittest` target aliases `production-test`, so regular Docker CI uses the same maintained base and MongoDB 7 test binaries. Local tests retain the MongoDB 6 default; the Mongo version can be selected explicitly through `MONGOMS_VERSION`.

The prerelease workflow, `runtime` Docker target, npm worker commands, and optional indexer profile remain supported. Production uses a separate target with only production npm dependencies, no MongoDB tools or package managers, and `USER 1000:1000`. Application files are root-owned and not writable by that user.

For this repository's Compose files:

```sh
export PRODUCTION_IMAGE='ghcr.io/adaliafoundation/influence-server@sha256:<released-digest>'
export HEALTH_NAMESPACE='production'

docker compose -f compose.yaml -f compose.prod.yaml --profile indexer pull
docker compose -f compose.yaml -f compose.prod.yaml --profile indexer up -d --no-build --wait --wait-timeout 600
```

Use a current Docker Compose version supporting `!reset` and `!override`. The production override removes the API's inherited development build and source mounts, uses direct `node` commands, and adds role-specific healthchecks. It requires `PRODUCTION_IMAGE` rather than defaulting to a moving tag. The shared base still expects its MongoDB URL, other application settings, and external `web` network to be supplied by your stack. This is not a complete production infrastructure/security configuration.

For an external stack/deployer:

- Set **the same released digest for the API and all four required workers**. Start Ethereum retrieval, Starknet retrieval, event processing and Elasticsearch indexing. The external development stack's indexer profile currently omits Ethereum retrieval; production must add it.
- Production has no npm/yarn; use `node src/api/server.js`, `node src/workers/eventRetriever.js --eventSource=ethereum`, `node src/workers/eventRetriever.js --eventSource=starknet`, `node src/workers/eventProcessor.js`, and `node src/workers/elasticsearch.js` respectively.
- Use `NODE_ENV=production` and the same `HEALTH_NAMESPACE` on every service. Set a distinct namespace for separate stacks sharing a database, including blue/green stacks. `IMAGE_REVISION` is baked into the image from the release SHA; do not override it independently on individual services.
- Run one instance of each worker role per namespace/revision. Health records are per role and include its container hostname. This matches the existing singleton worker deployment; horizontally scaling workers needs an explicit coordination design.
- Replace any root-only entrypoint behavior. Mount secrets read-only and readable by UID/GID `1000:1000`; do not rely on root-owned `0400` host files. For a host bind mount, use an appropriately restricted group-readable file and traversable parent directories, or assign ownership to UID 1000. Confirm readability **inside** the container; Compose bind-backed secrets do not necessarily honor requested secret `uid`/`gid` attributes.
- Do not mount source code or a host `node_modules` directory over `/app`. Read-only root filesystems, dropped capabilities and `no-new-privileges` are supported by the smoke test. Operational scripts that intentionally write files need an explicit writable output mount.
- Keep MongoDB backup/restore tools in the MongoDB container or a dedicated tooling image.
- Deploy the new worker revision before directing traffic to its API. Do not make worker startup depend on API readiness: readiness depends on those workers. A blue/green deployment needs distinct namespaces; do not start competing workers against the same workload without a coordination strategy.

## Secret files

Remove the shell entrypoint's file-to-environment translation. Supply `NAME_FILE=/run/secrets/name` and mount the file; the application resolves the contents through `config/local.js` before consumers read configuration. Existing plain `NAME=value` variables remain supported. A nonempty plain value together with `NAME_FILE` is a startup error. Remove the plain variable from `env_file`, Compose `environment`, and deployer-generated settings before enabling its file form. An empty plain variable is treated as unset.

Files are UTF-8, with surrounding whitespace/newlines trimmed. Missing, unreadable, empty, or directory paths fail startup with a diagnostic naming only the configuration variable. Unknown `_FILE` variables are ignored. File contents are not copied into `process.env` or inherited by child processes as ordinary secret variables. Secrets are loaded at process start; restart affected containers after rotation. Do not override these secret paths using `NODE_CONFIG`, local environment-specific configuration files, or CLI configuration. Do not replace the packaged `config/local.js` hook.

Supported names (append `_FILE`):

- `JWT_SECRET`, `ARGENT_API_KEY`
- `AVNU_PAYMASTER_API_KEY`, `AVNU_PAYMASTER_URL`
- `BANXA_API_KEY`, `BANXA_BASE_URL`, `BANXA_WEBHOOK_API_KEY`, `BANXA_WEBHOOK_SECRET`
- `MONGO_URL`, `REDIS_URL`, `ELASTICSEARCH_URL`
- `ETHEREUM_PROVIDER`, `STARKNET_RPC_PROVIDER`, `STARKNET_EVENT_RETRIEVER_RPC_PROVIDER`
- `STARKNET_FAUCET_PRIVATE_KEY`, `STARKNET_STARTER_PACK_PRIVATE_KEY`
- `IPFS_RPC_AUTHORIZATION`, `OPEN_SEA_API_KEY`, `SENDGRID_API_KEY`
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`

`STARKNET_STARTER_PACK_PRIVATE_KEY_FILE` keeps its existing path-based provisioner behavior and is also validated at startup. Existing `compose.provisioner-keyfile.yaml` remains usable after removing any simultaneous plain key and adjusting its file permissions for the production user.

Example service fragment (repeat applicable secret mounts/settings for workers):

```yaml
services:
  influence-server:
    environment:
      MONGO_URL_FILE: /run/secrets/mongo_url
      JWT_SECRET_FILE: /run/secrets/jwt_secret
    secrets:
      - mongo_url
      - jwt_secret
secrets:
  mongo_url:
    file: /etc/influence/secrets/mongo_url
  jwt_secret:
    file: /etc/influence/secrets/jwt_secret
```

Database secret files contain the **complete connection URI**. The separate Elasticsearch bootstrap password file must be owned by its container user and have mode `0400` or `0600`; Elasticsearch 8.19.20 rejects a world-readable password file. Redis TLS behavior remains compatible with the existing application: the supplied plaintext Redis container requires `REDIS_DISABLE_TLS=1`; preserve your existing TLS configuration for hosted Redis.

## Readiness and liveness

- `GET /livez`: HTTP 200 while the HTTP process responds; no dependency checks.
- `GET /readyz`: HTTP 200 only when MongoDB responds, both Socket.IO Redis clients are ready and Redis responds, Elasticsearch is green/yellow, and all four required workers report fresh successful progress. Otherwise HTTP 503. Bodies contain booleans only, with no URLs, credentials or upstream error messages.
- Both also support HEAD, bypass authentication and application rate limiting, and send `Cache-Control: no-store`.
- API container check: `node bin/healthcheck.js api`.
- Worker container checks: `node bin/healthcheck.js ethereum-retriever`, `starknet-retriever`, `event-processor`, or `elastic-indexer`.

Configure load-balancer routing/deployment acceptance from `/readyz`. Use liveness for restart decisions. Docker Compose marks an unhealthy container but does not automatically restart it just for becoming unhealthy; the deployer should surface that state. Fatal process failures exit nonzero and the existing restart policy can restart them.

Workers first report `starting`, then `ready` after successful loop completion (including idle loops). Retriever iteration failures report `failed`; a hung/crashed worker's last success expires. The default freshness limit is 180 seconds (`WORKER_MAX_AGE_MS=180000`), and dependency probes time out at 2 seconds (`HEALTH_TIMEOUT_MS=2000`). Adjust freshness above the longest legitimate RPC retry/batch duration and configured loop delay, consistently across API and workers. This checks processing health, not a guarantee that chain synchronization has caught up to the head. Keep container clocks synchronized.

Worker health uses the `workerhealth` MongoDB collection. Workers need read/write access and the API needs read access. Keys include namespace, revision and role; records from another release cannot satisfy readiness. Expiration is checked in application code, so no index migration is required. Historical release records can be pruned during maintenance; there are four per namespace/revision. Prerelease/development require no worker records by default.

## Mezmo / logging

Production defaults to newline-delimited JSON. Configure the collector to parse each stdout/stderr line as JSON, retain `timestamp`, `level`, `message` and structured fields, and stop relying on colored Winston or koa-logger text. Human-readable formatting remains the default outside production. `LOG_FORMAT=json` can enable JSON elsewhere.

Redaction happens in the process before collection: credential fields, authorization/cookie headers, request/response/payment bodies, and provider URLs are removed. Request logs contain method, matched route template, status, duration and a generated request ID; raw URLs, query strings and bodies are excluded. Full upstream errors are not serialized because messages and attached HTTP objects can contain payment data. MongoDB query debugging is disabled in production. The image's `NODE_OPTIONS` preloads console/error sanitization; preserve it when adding other Node options.

Do not configure the collector or deployer to dump container environments, secret files, payment bodies or raw network traces. These are outside the application's logger. Operational credential-generation commands must use a secure delivery mechanism rather than expecting secrets in collected application logs.

## Validation / rollback

```sh
npm test
# Includes the standalone deployment regression suite:
npm run test:deployment

docker build --target production --build-arg IMAGE_REVISION=local-validation \
  -t influence-server:production-test .
bash scripts/test-production-image.sh influence-server:production-test
```

The smoke test uses digest-pinned MongoDB 7.0.41, Redis 7.2.16 and Elasticsearch 8.19.20 with authentication enabled (Elasticsearch HTTP TLS disabled), complete URI secret files and a read-only non-root application container. It verifies rejection of anonymous database access, production dependency/tool exclusions, authenticated API startup, worker readiness/freshness, role-specific probes, a real Redis stall/recovery, and JSON log safety. Worker heartbeat records in this smoke test are supplied by the test harness; event processing itself is covered by the server unit tests. It does not contact real RPC or payment providers. This is a server contract test, not proof that the production stack works. The stack repository must own an integration test using its actual Compose files, pinned service images, generated secrets, all four real workers, readiness checks and deployment/rollback behavior. Update this representative fixture deliberately when compatibility requirements change; it does not dictate stack versions.

Rollback by restoring the previous verified digest on **all** server/worker services, preserving its matching configuration and secrets, then wait for readiness. No business-data schema migration is introduced by these changes.

## Reviewed upstream findings (2026-09-10)

The refreshed local AMD64 scan reports 7 Critical package matches (6 distinct advisories) and 57 High matches, all without available fixes. The six Critical advisories were reviewed against the packaged API/worker runtime: three are excluded by architecture or absent modules; the other three have no identified affected application execution path. Seven narrowly matched, expiring `not_affected` entries record these decisions. See [the review and evidence](../security/production-vulnerability-review.md).

The local gate now reports **0 blocking, 7 excepted, 57 warnings**. No High/Critical npm findings remain in this report. Unfixed High warnings are not a claim of non-applicability; revisit them during regular dependency/base-image updates. CI must still scan and smoke-test its actual candidate digest, and new findings or expired decisions can block it.

## Generate an API credential

Use an explicit private output file; the generated secret is never sent to application logs:

```sh
node bin/generateApiKey.js --name 'Stack client' --output /credentials/stack-client.json
```

The JSON file contains `name`, `client_id` and the plaintext `client_secret`; MongoDB stores only the secret's hash. The output must not already exist (symlinks are also rejected), and is created with mode `0600`. In the production container, mount a private writable directory at `/credentials` owned by UID 1000. Deliver the file securely to the client and remove it after provisioning; keep it outside log collection and source control. A failed command exits nonzero. The previous log-only invocation now requires `--output` in every environment.

### Optional IPFS storage

IPFS uploads are disabled unless `IPFS_RPC_URL` is configured. Local CID hashing
and database reads remain available; upload requests return HTTP 503 when storage
is unconfigured. No provider or gateway is selected by default, including in
production and prerelease configurations.

Set these independently for each deployment:

- `IPFS_RPC_URL`: Kubo-compatible API root, including `/api/v0`.
- `IPFS_RPC_AUTHORIZATION`: complete Authorization header, or use
  `IPFS_RPC_AUTHORIZATION_FILE` for a mounted secret. Omit for an unauthenticated
  private Kubo endpoint. Never expose RPC credentials to browser clients.
- `IPFS_GATEWAY_URL`: gateway origin/base before `/ipfs/<CID>`, used by the
  Starknet setup scripts. Configure the frontend gateway separately.

For Filebase, create an IPFS bucket and generate its bucket-specific token on the
Access Keys page. Set `IPFS_RPC_URL=https://rpc.filebase.io/api/v0` and configure
`IPFS_RPC_AUTHORIZATION` as `Bearer <token>`. No S3 keys or bucket-name environment
variable is needed. See https://filebase.com/docs/ipfs/rpc-api.

The client uploads UTF-8 content with CIDv0, SHA-256, 256 KiB chunks, DAG-PB leaves,
and no wrapping directory, matching local hashing. A mismatched returned CID or
upstream failure returns HTTP 502 and is not saved as a successful upload.
Before enabling production writes, verify uploads, pin status, and byte-for-byte
retrieval against the selected provider, including a payload larger than 256 KiB.
Existing stored CIDs and legacy service metadata are retained; changing the RPC
endpoint does not migrate existing pins. Content migration is a separate step.
