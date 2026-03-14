import { describe, expect, it, vi } from "vitest";

import { createHueClient } from "../../src/index";
import { jsonResponse, readRequestJson } from "./helpers";

describe("light helper methods", () => {
  it("serializes light helper state to the expected LightPut payload", async () => {
    const capturedBodies: unknown[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      capturedBodies.push(await readRequestJson(request));
      return jsonResponse({
        data: [{ rid: "light-1", rtype: "light" }],
        errors: [],
      });
    });

    const client = createHueClient({
      applicationKey: "test-key",
      bridgeUrl: "https://bridge.local",
      fetch,
    });

    await client.lights.applyState("light-1", {
      brightness: 42,
      colorTemperatureMirek: 300,
      on: true,
      transitionMs: 1000,
      xy: { x: 0.1, y: 0.2 },
    });

    expect(capturedBodies[0]).toEqual({
      color: { xy: { x: 0.1, y: 0.2 } },
      color_temperature: { mirek: 300 },
      dimming: { brightness: 42 },
      dynamics: { duration: 1000 },
      on: { on: true },
    });
  });

  it("serializes grouped light helper state to the expected GroupedLightPut payload", async () => {
    const capturedBodies: unknown[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      capturedBodies.push(await readRequestJson(request));
      return jsonResponse({
        data: [{ rid: "group-1", rtype: "grouped_light" }],
        errors: [],
      });
    });

    const client = createHueClient({
      applicationKey: "test-key",
      bridgeUrl: "https://bridge.local",
      fetch,
    });

    await client.groupedLights.applyState("group-1", {
      brightness: 55,
      colorTemperatureMirek: 250,
      on: false,
      transitionMs: 500,
      xy: { x: 0.3, y: 0.4 },
    });

    expect(capturedBodies[0]).toEqual({
      color: { xy: { x: 0.3, y: 0.4 } },
      color_temperature: { mirek: 250 },
      dimming: { brightness: 55 },
      dynamics: { duration: 500 },
      on: { on: false },
    });
  });
});
