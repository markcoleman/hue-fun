# Agent Playbooks

## Add a new helper method

Prompt template:

> Add a new high-level helper to `createHueClient()` for a CLIP v2 capability already present in `src/generated`. Reuse generated operations, normalize `errors[]`, add Vitest coverage, and do not edit `src/generated` manually.

## Regenerate after spec changes

Prompt template:

> Regenerate the SDK from `openhue.yaml`, inspect the diff in `src/generated`, update handwritten wrappers if any response or request shapes changed, and run `npm run generate:check`, `npm run typecheck`, and `npm test`.

## Add a live harness command

Prompt template:

> Extend `scripts/harness.ts` with a new safe command. Read-only commands should require only env vars. State-changing commands must require `--write` and be documented in `docs/testing.md`.

## Investigate event issues

Prompt template:

> Diagnose event stream behavior in `client.events.stream()`, preserve reconnect behavior and `If-None-Match` handling, add regression tests in `test/unit/sse.test.ts`, and avoid breaking the JSON polling helper.
