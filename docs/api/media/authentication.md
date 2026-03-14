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
