# Testing and Harness

## Local verification

```bash
npm run generate:check
npm run typecheck
npm test
npm run build
npm run docs
```

## Unit coverage

The test suite validates:

- authentication success and link-button failures
- auth header injection and request timeout behavior
- light and grouped-light helper payload serialization
- API error normalization for `errors[]` payloads
- SSE parsing and event stream handling

## Live bridge harness

The harness automatically loads `.env` from the repo root before reading environment variables. Existing shell variables still take precedence.

Environment variables:

- `HUE_BRIDGE_URL`
- `HUE_APP_KEY`
- `HUE_CLIENT_KEY` (optional)
- `HUE_DEVICE_TYPE` (optional, used by `auth`)
- `HUE_INSECURE_TLS=0` (optional, opt back in to strict TLS verification)
- `HUE_DEBUG_HTTP=1` (optional, logs request URL and headers from the harness)

Examples:

```bash
npm run harness -- discover
npm run harness -- list-lights
npm run harness -- list-lights --json
npm run harness -- list-lights --debug-http
npm run harness -- get-light <light-id>
npm run harness -- toggle <light-id> on --write
npm run harness -- brightness <light-id> 55 --write
npm run harness -- scene-recall <scene-id> --write
npm run harness -- stream-events --limit 5
npm run harness -- auth --bridge-url https://<bridge-ip> --insecure-tls
```

State-changing commands require `--write` so the harness stays safe by default.
`list-lights` prints a compact table by default; pass `--json` for the full payload.
The harness defaults to insecure TLS for local Hue bridges; use `--secure-tls` if you want strict certificate verification.

## Interactive CLI smoke checks

The dedicated CLI is separate from the harness. It is intended for normal control flows and scripting, while the harness stays focused on low-level bridge validation.

Examples:

```bash
npm run cli -- status --json
npm run cli -- lights list
npm run cli -- rooms set Office --brightness 20
npm run cli -- scenes recall Concentrate
npm run cli -- workflow run movie-time --dry-run --json
npm run build:exe
```

Suggested manual smoke checklist against a real bridge:

- `npm run cli -- auth --bridge-url https://<bridge-ip>`
- `npm run cli -- ui`
- `npm run cli -- lights on <light-name-or-id>`
- `npm run cli -- lights off <light-name-or-id>`
- `npm run cli -- rooms assign <room-name-or-id> <device-or-light> --yes`
- `npm run cli -- zones set <zone-name-or-id> --brightness 25`
- `npm run cli -- workflow run <workflow-name>`
- `./build/hue-<platform>-<arch> --help`
