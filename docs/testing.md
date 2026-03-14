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
