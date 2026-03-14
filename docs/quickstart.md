# Quick Start

## 1. Install dependencies

```bash
npm install
npm run generate
```

## 2. Discover the bridge

```ts
import { discoverHueBridges } from "openhue-client";

const bridges = await discoverHueBridges();
console.log(bridges);
```

## 3. Authenticate once

Press the bridge link button and request a key:

```ts
import { authenticate } from "openhue-client";

const credentials = await authenticate({
  bridgeUrl: "https://192.168.1.10",
  deviceType: "my-app#desktop",
  generateClientKey: true,
});
```

## 4. Create a client

```ts
import { createHueClient } from "openhue-client";

const client = createHueClient({
  applicationKey: process.env.HUE_APP_KEY!,
  bridgeUrl: "https://192.168.1.10",
});
```

## 5. Use high-level helpers

```ts
const lights = await client.lights.list();
await client.lights.setBrightness(lights[0]!.id, 50);
await client.scenes.recall("scene-id");
```

## 6. Use the raw generated SDK when needed

```ts
const response = await client.raw.getScenes();
console.log(response.data?.data);
```
