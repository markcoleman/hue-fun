import { describe, expect, it, vi } from "vitest";

import { createHueClient } from "../../src/index";
import { jsonResponse } from "./helpers";

describe("client transport", () => {
  it("injects the Hue application key and default headers into generated requests", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      expect(request.url).toBe("https://bridge.local/clip/v2/resource/light");
      expect(request.headers.get("hue-application-key")).toBe("test-key");
      expect(request.headers.get("x-suite")).toBe("unit");
      return jsonResponse({ data: [], errors: [] });
    });

    const client = createHueClient({
      applicationKey: "test-key",
      bridgeUrl: "https://bridge.local/",
      fetch,
      headers: {
        "x-suite": "unit",
      },
    });

    await expect(client.lights.list()).resolves.toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("aborts requests when timeoutMs is exceeded", async () => {
    const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
      return new Promise<Response>((_, reject) => {
        signal?.addEventListener(
          "abort",
          () => reject(signal.reason ?? new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      });
    });

    const client = createHueClient({
      applicationKey: "test-key",
      bridgeUrl: "https://bridge.local",
      fetch,
      timeoutMs: 5,
    });

    await expect(client.lights.list()).rejects.toThrow(/timed out|AbortError/i);
  });
});
