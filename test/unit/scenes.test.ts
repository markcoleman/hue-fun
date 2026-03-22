import { describe, expect, it, vi } from "vitest";

import { createHueClient } from "../../src/index";
import { jsonResponse, readRequestJson } from "./helpers";

describe("scene helper methods", () => {
  it("uses the default active recall payload", async () => {
    const capturedBodies: unknown[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      capturedBodies.push(await readRequestJson(request));
      return jsonResponse({
        data: [{ rid: "scene-1", rtype: "scene" }],
        errors: [],
      });
    });

    const client = createHueClient({
      applicationKey: "test-key",
      bridgeUrl: "https://bridge.local",
      fetch,
    });

    await expect(client.scenes.recall("scene-1")).resolves.toEqual([{ rid: "scene-1", rtype: "scene" }]);
    expect(capturedBodies).toEqual([{ recall: { action: "active" } }]);
  });

  it("unwraps a single scene by id", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({
        data: [{ id: "scene-1", metadata: { name: "Focus" } }],
        errors: [],
      }),
    );

    const client = createHueClient({
      applicationKey: "test-key",
      bridgeUrl: "https://bridge.local",
      fetch,
    });

    await expect(client.scenes.get("scene-1")).resolves.toMatchObject({
      id: "scene-1",
      metadata: { name: "Focus" },
    });
  });
});
