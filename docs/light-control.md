# Light Control

## Helpers

The high-level client exposes ergonomic light and grouped-light methods for common actions.

```ts
const client = createHueClient({
  applicationKey: process.env.HUE_APP_KEY!,
  bridgeUrl: process.env.HUE_BRIDGE_URL!,
});

await client.lights.on("light-id");
await client.lights.off("light-id");
await client.lights.setBrightness("light-id", 60);
await client.lights.setColorTemperature("light-id", 250);
await client.lights.setColorXY("light-id", { x: 0.2, y: 0.3 });
```

## Generic state updates

```ts
await client.lights.applyState("light-id", {
  brightness: 35,
  colorTemperatureMirek: 300,
  on: true,
  transitionMs: 1500,
  xy: { x: 0.12, y: 0.19 },
});
```

Grouped lights follow the same pattern via `client.groupedLights`.

## Scenes

```ts
const scenes = await client.scenes.list();
await client.scenes.recall(scenes[0]!.id);
```

For lower-level access, use `client.raw.updateLight()` or other generated methods directly.
