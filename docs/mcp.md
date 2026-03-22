# MCP Server

The project can now expose the Hue bridge through MCP over either stdio or Streamable HTTP.

## Transports

### Stdio

Use stdio for local desktop/tool integrations that launch the server as a subprocess:

```bash
npm run mcp
npm run cli -- mcp
./dist/hue-mcp.mjs
```

### HTTP

Use HTTP when you want to run the MCP server as a long-lived process or container:

```bash
npm run cli -- mcp --transport http --host 127.0.0.1 --port 8080 --api-key local-dev-secret
npm run mcp:http -- --api-key local-dev-secret
./dist/hue-mcp.mjs --transport http --host 127.0.0.1 --port 8080 --api-key local-dev-secret
```

The HTTP endpoint is always exposed at `/mcp`.

## HTTP security

The HTTP transport is intentionally locked down:

- it requires an API key for every POST request
- it validates the `Origin` header when one is present
- it binds to `127.0.0.1` by default unless you explicitly override the host

Send the MCP API key in either of these request headers:

- `Authorization: Bearer <secret>`
- `X-API-Key: <secret>`

Configure the secret via one of:

- `--api-key <secret>`
- `--api-key-file <path>`
- `HUE_MCP_API_KEY`
- `HUE_MCP_API_KEY_FILE`

If you expect browser-originated traffic, also configure allowed origins:

```bash
export HUE_MCP_ALLOWED_ORIGINS="https://chat.openai.com,https://chatgpt.com"
```

## Passing the Hue application key by header

If you do not want to bake a Hue application key into config, env, or a profile, the MCP HTTP server can accept it per request and forward it into the Hue client.

Supported request headers:

- `Hue-Application-Key`
- `X-Hue-Application-Key` (or a custom header set with `--hue-app-key-header` / `HUE_MCP_HUE_APP_KEY_HEADER`)

Example:

```http
POST /mcp
Authorization: Bearer <mcp-secret>
Hue-Application-Key: <hue-app-key>
Content-Type: application/json
Accept: application/json, text/event-stream
```

When that header is present, the server uses it as the downstream Hue application key for the current MCP request.

## Docker image

Build the image:

```bash
docker build -t newhue-mcp .
```

Run it with a Docker secret mounted as a file:

```bash
echo -n "replace-with-long-random-secret" > .secrets/hue-mcp-api-key

docker run --rm -p 8080:8080 \
  -e HUE_BRIDGE_URL=https://bridge.local \
  -e HUE_MCP_API_KEY_FILE=/run/secrets/hue_mcp_api_key \
  -e HUE_MCP_ALLOWED_ORIGINS=https://chat.openai.com,https://chatgpt.com \
  -v "$PWD/.secrets/hue-mcp-api-key:/run/secrets/hue_mcp_api_key:ro" \
  newhue-mcp
```

If you prefer Docker Compose secrets:

```yaml
services:
  hue-mcp:
    build: .
    ports:
      - "8080:8080"
    environment:
      HUE_BRIDGE_URL: https://bridge.local
      HUE_MCP_API_KEY_FILE: /run/secrets/hue_mcp_api_key
      HUE_MCP_ALLOWED_ORIGINS: https://chat.openai.com,https://chatgpt.com
    secrets:
      - hue_mcp_api_key

secrets:
  hue_mcp_api_key:
    file: ./.secrets/hue-mcp-api-key
```

## GitHub Container Registry publishing

The repository CI workflow now publishes the MCP container image to GitHub Container Registry after the full test matrix succeeds on pushes to `main`. The workflow uses the built-in `GITHUB_TOKEN` and explicitly requests `packages: write` plus `contents: read`, which is enough for GHCR pushes without over-granting broader repository permissions.

Published image name pattern:

```text
ghcr.io/<owner>/<repo>-mcp:latest
ghcr.io/<owner>/<repo>-mcp:sha-<short-sha>
```

If package publishing is disabled at the repository or organization level, enable GitHub Actions package publishing for GHCR before relying on the automation.

## Configuration reference

### Existing Hue config inputs

These continue to work for MCP just like the CLI:

- `--bridge-url` / `HUE_BRIDGE_URL`
- `--app-key` / `HUE_APP_KEY`
- `--client-key` / `HUE_CLIENT_KEY`
- `--profile`
- `--config`
- `--env-file`
- saved keychain secrets

### MCP-specific inputs

- `--transport` / `HUE_MCP_TRANSPORT`
- `--host` / `HUE_MCP_HOST`
- `--port` / `HUE_MCP_PORT`
- `--api-key` / `HUE_MCP_API_KEY`
- `--api-key-file` / `HUE_MCP_API_KEY_FILE`
- `--allow-origin` / `HUE_MCP_ALLOWED_ORIGINS`
- `--hue-app-key-header` / `HUE_MCP_HUE_APP_KEY_HEADER`
