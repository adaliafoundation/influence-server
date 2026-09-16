# Migrating the CID inventory to Filebase

Run `scripts/migrate-ipfs-pins.cjs` with Node 22. It has no additional dependencies,
accepts whitespace-separated CIDv0s, and does not connect to MongoDB.

Set `FILEBASE_TOKEN` locally to the token for the destination IPFS bucket. Do not
commit the token, inventory, or generated reports. Run only one migration process
for the inventory and bucket at a time.

```sh
# Validate without network access or credentials.
node scripts/migrate-ipfs-pins.cjs --input /absolute/path/cids.txt

# Inspect the bucket without changing any pins.
node scripts/migrate-ipfs-pins.cjs --input /absolute/path/cids.txt \
  --check --report /tmp/filebase-check.json

# Submit missing pins and poll for up to ten minutes after the submission pass.
node scripts/migrate-ipfs-pins.cjs --input /absolute/path/cids.txt \
  --apply --report /tmp/filebase-migration.json
```

Every CID is checked against Filebase before submission. Existing queued, pinning,
and pinned requests are reused. Rerun the same command after an interruption to
resume by reconciling with the destination bucket; the old local report is not
used as proof of storage. Reports are overwritten atomically after each CID.
Use separate report paths if you want to retain previous runs.

Existing failed requests are reported without resubmission. After investigating
content availability, add `--retry-failed` to an apply run to submit new requests
for them. The old failed requests are not deleted. Authentication and rate-limit
errors stop the run; request errors are recorded without logging credentials or
response bodies. An ambiguous POST failure is reconciled on a later run rather
than automatically retried.

The report lists each CID, provider status and request ID (when available), plus
summary counts. Exit code 0 means validation succeeded, or all queried CIDs are
pinned. Exit code 2 means some CIDs are missing, pending, failed, or errored. Exit
code 1 means a fatal error. `--wait-seconds 0` skips polling; `--check` never polls.

Provider pin status is not an independent retrieval/integrity test. Once pins
complete, verify content retrieval through the configured Filebase gateway.
If content is unavailable across IPFS, pin requests cannot recreate it from a
CID alone: recover original bytes or CAR archives from surviving sources.

API reference: https://filebase.com/docs/legacy/ipfs/pinning-service-api

Tests: `node --test scripts/migrate-ipfs-pins.test.cjs`
