# OpenHue Client

TypeScript client and helper layer for the Philips Hue CLIP v2 API, generated from `openhue.yaml` and wrapped with ergonomic helpers for authentication, lights, grouped lights, scenes, and event streaming.

## Highlights

- Full generated low-level SDK under `client.raw`
- High-level helpers for common Hue workflows
- Dedicated `hue` CLI with profiles, JSON output, and saved workflows
- Opt-in bridge harness for manual validation against a real bridge
- Strict TypeScript, Vitest coverage, TypeDoc API docs, and GitHub Actions CI

## Install

```bash
npm install
```

## Commands

Run `npm run validate` for the default contributor and agent verification path.


```bash
npm run generate
npm run generate:check
npm run typecheck
npm test
npm run build
npm run validate
npm run build:exe
npm run docs
npm run harness -- discover
npm run cli -- status
```

## Quick Start

```ts
import { createHueClient, discoverHueBridges } from "openhue-client";

const [bridge] = await discoverHueBridges();
const client = createHueClient({
  applicationKey: process.env.HUE_APP_KEY!,
  bridgeUrl: bridge.baseUrl,
});

const lights = await client.lights.list();
await client.lights.on(lights[0]!.id);
```

## Authentication

Press the physical link button on the bridge, then run:

```bash
npm run harness -- auth --bridge-url https://<bridge-ip> --client-key
```

In code:

```ts
import { authenticate } from "openhue-client";

const credentials = await authenticate({
  bridgeUrl: "https://192.168.1.10",
  deviceType: "my-app#desktop",
  generateClientKey: true,
});
```

## CLI

The repo also includes a dedicated `hue` CLI for scripting and interactive control.

```bash
npm run cli -- status
npm run cli -- lights list
npm run cli -- rooms set Office --brightness 20
npm run cli -- workflow run movie-time --dry-run --json
npm run build:exe
```

See the full guide in [docs/cli.md](docs/cli.md).

## High-Level API

```ts
const client = createHueClient({
  applicationKey: "...",
  bridgeUrl: "https://192.168.1.10",
});

await client.lights.setBrightness("light-id", 55);
await client.groupedLights.off("grouped-light-id");
await client.scenes.recall("scene-id");

for await (const message of client.events.stream({ reconnect: false })) {
  console.log(message.id, message.events);
}
```

## Raw SDK Access

The generated low-level SDK is available via `client.raw` and mirrors the spec `operationId` names:

```ts
const response = await client.raw.getLights();
```

## Docs

- [Quick start](docs/quickstart.md)
- [Authentication](docs/authentication.md)
- [Interactive CLI](docs/cli.md)
- [Light control](docs/light-control.md)
- [Event streaming](docs/event-streaming.md)
- [Testing and harness](docs/testing.md)
- [Agent playbooks](docs/agent-playbooks.md)
- [GitHub Pages publishing](docs/github-pages.md)
- [Contributing guide](CONTRIBUTING.md)
- API reference: `npm run docs` outputs to `docs/api`

Build the GitHub Pages site locally with `SITE_ORIGIN=https://example.com SITE_BASE_PATH=/openhue-client npm run pages:build`.

## Project Layout

- `openhue.yaml`: source OpenAPI document
- `src/generated`: machine-generated SDK, never edit manually
- `src/client.ts`: handwritten ergonomic client layer
- `scripts/harness.ts`: manual bridge validation CLI
- `test/unit`: deterministic unit suite

## Regenerating the SDK

```bash
npm run generate
npm run generate:check
```

If `generate:check` fails, regenerate and commit the updated contents of `src/generated`.
