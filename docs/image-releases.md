# Image releases and deployment requests

Server and client use the same release entry points:

| Actions workflow | Trigger | GitHub environment | Image tags |
| --- | --- | --- | --- |
| Release prerelease image | Push to prerelease or manual run on prerelease | prerelease | stack-prerelease-COMMIT and stack-prerelease |
| Release production image | Manual run on main with a full main-history commit SHA | production | production-COMMIT, production, latest |

`docker-stack-prerelease.yaml` calls `docker-production.yaml` with `channel: prerelease`.
The manual entry point defaults to production. Tests, image scans, smoke checks,
and signing precede channel promotion. The same commit can be released separately
in both channels; immutable channel/commit tags cannot be overwritten. If publication succeeded
but the webhook failed, use the published digest and inspect the host before
retrying deployment; a full release rerun refuses to overwrite the immutable tag.

The environment job is named **Publish prerelease image and request deployment**
or **Publish production image** in both repositories. Configure each GitHub
environment to allow its branch: `prerelease` for prerelease, `main` for production.
Keep production's required reviewers; prerelease should have no reviewers or wait
timer for automatic releases.

In the prerelease environment, configure variable `STACK_PRERELEASE_WEBHOOK_URL`
and secret `STACK_PRERELEASE_WEBHOOK_TOKEN` when the host is ready. Leave the URL
unset during initial host preparation. Environment variables and secrets are
available to the environment job, not the image build jobs.

Only a release matching the current head of `prerelease` advances the prerelease
alias. Pushes to `main` do not publish or deploy prerelease images. Each release
validates that the source commit belongs to its channel's branch history before
executing candidate code. Other workflow branches cannot release either channel.
The notification step also checks that the alias still matches its image digest.
A blank webhook URL skips notification while still publishing the image.

A green GitHub environment entry means publication and any configured deployment
request succeeded. The webhook only acknowledges the request; it does not wait
for the host's integration tests, container updates, or health checks.
Check the host's journal and stack status to confirm deployment completion.
Production host deployment remains manual using the released immutable digest.
