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

Environment variables:

- `HUE_BRIDGE_URL`
- `HUE_APP_KEY`
- `HUE_CLIENT_KEY` (optional)
- `HUE_DEVICE_TYPE` (optional, used by `auth`)
- `HUE_INSECURE_TLS=1` (optional, disables TLS verification for trusted local bridges)

Examples:

```bash
npm run harness -- discover
npm run harness -- list-lights
npm run harness -- get-light <light-id>
npm run harness -- toggle <light-id> on --write
npm run harness -- brightness <light-id> 55 --write
npm run harness -- scene-recall <scene-id> --write
npm run harness -- stream-events --limit 5
npm run harness -- auth --bridge-url https://<bridge-ip> --insecure-tls
```

State-changing commands require `--write` so the harness stays safe by default.
Use `--insecure-tls` only on a trusted local network when the bridge certificate cannot be verified.
