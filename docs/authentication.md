# Authentication

Hue bridge authentication is local-network only and requires pressing the bridge link button shortly before requesting credentials.

## Programmatic authentication

```ts
import { authenticate } from "openhue-client";

const result = await authenticate({
  bridgeUrl: "https://192.168.1.10",
  deviceType: "my-app#desktop",
  generateClientKey: true,
});
```

## Returned fields

- `applicationKey`: the Hue application key used for CLIP v2 requests
- `clientKey`: optional entertainment client key returned when `generateClientKey` is true

## Failure handling

- `HueLinkButtonNotPressedError`: the link button was not pressed in time
- `HueAuthError`: the bridge returned an unexpected or unsuccessful auth payload
- `HueHttpError`: the bridge responded with a non-2xx HTTP status

## Harness command

```bash
npm run harness -- auth --bridge-url https://<bridge-ip> --device-type my-app#desktop --client-key
```

If the bridge presents a self-signed local certificate, the harness may fail with `fetch failed` followed by a certificate cause. On a trusted local network, retry with:

```bash
npm run harness -- auth --bridge-url https://<bridge-ip> --client-key --insecure-tls
```

Or set `HUE_INSECURE_TLS=1` for the harness process.
