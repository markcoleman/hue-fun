# Interactive CLI

The project ships a dedicated `hue` CLI for local control, scripting, and repeatable workflows.

## Install and run

During development:

```bash
npm install
npm run cli -- status
```

After building, the generated executable entries are available as:

```bash
npm run build
./dist/hue.mjs status
./dist/hue-mcp.mjs
```

To build a self-contained standalone executable for the current platform and architecture:

```bash
npm run build:exe
./build/hue-$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m) --help
```

The standalone executable embeds Node via SEA, so it does not require Node to be installed on the target machine.

## MCP server

The package now exposes MCP over both stdio and HTTP. For the full transport, Docker, secret, and header-forwarding setup guide, see [`docs/mcp.md`](./mcp.md).

Quick examples:

```bash
npm run mcp
npm run cli -- mcp
npm run cli -- mcp --transport http --host 127.0.0.1 --port 8080 --api-key local-dev-secret
./dist/hue-mcp.mjs --transport http --host 127.0.0.1 --port 8080 --api-key local-dev-secret
```

The MCP server resolves bridge settings the same way as the interactive CLI, so `--bridge-url`, `--app-key`, `--profile`, `.env`, and saved keychain secrets all still apply.

Exposed tools:

- `get_status`
- `list_lights`
- `get_light`
- `set_light_state`
- `list_rooms`
- `set_room_state`
- `list_zones`
- `set_zone_state`
- `list_scenes`
- `recall_scene`

## Config and secret precedence

Resolution order is:

1. CLI flags such as `--bridge-url` and `--app-key`
2. Process env plus values loaded from `.env`
3. The selected profile in YAML config
4. Built-in defaults

Secrets are never written into YAML by the CLI. Persistent credentials are stored in the OS keychain when `keytar` is available.

The self-contained SEA executable intentionally does not load `keytar`, so keychain persistence is unavailable there. Use env vars, flags, or a pre-populated YAML profile for standalone deployments.

Supported global flags:

- `--profile <name>`
- `--bridge-url <url>`
- `--app-key <key>`
- `--client-key <key>`
- `--config <path>`
- `--env-file <path>`
- `--secure-tls`
- `--debug-http`
- `--json`
- `--no-color`
- `--yes`

The CLI auto-loads `.env` from the current working directory unless `--env-file` is provided.

## Authentication and profiles

Authenticate against a bridge and save the resulting credentials under the current profile:

```bash
npm run cli -- auth --bridge-url https://192.168.1.10
```

Request an entertainment client key too:

```bash
npm run cli -- auth --bridge-url https://192.168.1.10 --generate-client-key
```

Profile helpers:

```bash
npm run cli -- profile list
npm run cli -- profile show default
npm run cli -- profile use studio
npm run cli -- profile remove studio --yes
```

## Core commands

Examples:

```bash
npm run cli -- lights list
npm run cli -- lights set "Desk Lamp" --brightness 55 --on
npm run cli -- rooms set Office --brightness 20
npm run cli -- zones off "Focus Zone"
npm run cli -- scenes recall Concentrate
npm run cli -- status --json
```

For automation, add `--json` to list, get, status, and workflow runs.

## Interactive mode

Launch the prompt-driven UI:

```bash
npm run cli -- ui
```

The interactive UI supports:

- bridge status
- quick light toggle
- room and zone on/off controls
- scene recall
- workflow execution

## Workflows

Workflows are saved per profile in YAML config and store resource IDs for repeatability.

Create one interactively:

```bash
npm run cli -- workflow create movie-time
```

Inspect or run it:

```bash
npm run cli -- workflow show movie-time
npm run cli -- workflow run movie-time
npm run cli -- workflow run movie-time --dry-run --json
```

Workflow step kinds are limited to:

- `light.set`
- `room.set`
- `zone.set`
- `scene.recall`
- `delay`
