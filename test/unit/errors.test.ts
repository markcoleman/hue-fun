import { describe, expect, it, vi } from "vitest";

import { createHueClient, HueApiError } from "../../src/index";
import { jsonResponse } from "./helpers";

describe("API error handling", () => {
  it("throws HueApiError when the bridge returns an errors array inside a 200 response", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({
        data: [],
        errors: [{ description: "bridge busy" }],
      }),
    );

    const client = createHueClient({
      applicationKey: "test-key",
      bridgeUrl: "https://bridge.local",
      fetch,
    });

    await expect(client.lights.list()).rejects.toBeInstanceOf(HueApiError);
  });

  it("returns resource identifiers from write responses", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({
        data: [{ rid: "light-1", rtype: "light" }],
        errors: [],
      }),
    );

    const client = createHueClient({
      applicationKey: "test-key",
      bridgeUrl: "https://bridge.local",
      fetch,
    });

    await expect(client.lights.on("light-1")).resolves.toEqual([{ rid: "light-1", rtype: "light" }]);
  });
});
