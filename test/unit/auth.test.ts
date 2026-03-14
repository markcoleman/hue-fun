import { describe, expect, it, vi } from "vitest";

import { authenticate, HueLinkButtonNotPressedError } from "../../src/index";
import { jsonResponse, readRequestJson } from "./helpers";

describe("authenticate", () => {
  it("returns the application key and client key from the Hue auth response", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      expect(request.url).toBe("https://bridge.local/api");
      expect(await readRequestJson(request)).toEqual({
        devicetype: "test-app#instance",
        generateclientkey: true,
      });
      return jsonResponse([
        {
          success: {
            clientkey: "client-key",
            username: "application-key",
          },
        },
      ]);
    });

    await expect(
      authenticate({
        bridgeUrl: "https://bridge.local/",
        deviceType: "test-app#instance",
        fetch,
        generateClientKey: true,
      }),
    ).resolves.toEqual({
      applicationKey: "application-key",
      clientKey: "client-key",
    });
  });

  it("omits generateclientkey unless a client key is requested", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      expect(await readRequestJson(request)).toEqual({
        devicetype: "test-app#instance",
      });
      return jsonResponse([
        {
          success: {
            username: "application-key",
          },
        },
      ]);
    });

    await expect(
      authenticate({
        bridgeUrl: "https://bridge.local",
        deviceType: "test-app#instance",
        fetch,
      }),
    ).resolves.toEqual({
      applicationKey: "application-key",
    });
  });

  it("throws a dedicated error when the bridge link button was not pressed", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse([
        {
          error: {
            address: "",
            description: "link button not pressed",
            type: 101,
          },
        },
      ]),
    );

    await expect(
      authenticate({
        bridgeUrl: "https://bridge.local",
        deviceType: "test-app#instance",
        fetch,
      }),
    ).rejects.toBeInstanceOf(HueLinkButtonNotPressedError);
  });

  it("surfaces transport failures from fetch", async () => {
    const fetch = vi.fn(async () => {
      throw new Error("network down");
    });

    await expect(
      authenticate({
        bridgeUrl: "https://bridge.local",
        deviceType: "test-app#instance",
        fetch,
      }),
    ).rejects.toThrow("network down");
  });
});
