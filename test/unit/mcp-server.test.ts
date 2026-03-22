import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { HueMcpServer, createHueMcpHttpServer } from "../../src/mcp/server";
import type { SecretStore, StoredSecrets } from "../../src/cli/types";
import { jsonResponse, readRequestJson } from "./helpers";

type RequestLog = {
  body: unknown;
  headers: Record<string, string>;
  method: string;
  url: string;
};

function createKeychain(initial: Record<string, StoredSecrets> = {}): SecretStore {
  const values = new Map(Object.entries(initial));
  return {
    async delete(profile) {
      values.delete(profile);
    },
    async get(profile) {
      return values.get(profile);
    },
    async has(profile) {
      return values.has(profile);
    },
    async isAvailable() {
      return true;
    },
    async set(profile, secrets) {
      values.set(profile, secrets);
    },
  };
}

function createFixture() {
  const devices = [
    {
      id: "device-1",
      metadata: { name: "Desk Lamp" },
      services: [{ rid: "light-1", rtype: "light" }],
    },
  ] as any[];

  const lights = [
    {
      dimming: { brightness: 41 },
      id: "light-1",
      metadata: { name: "Desk Lamp" },
      on: { on: true },
      owner: { rid: "device-1", rtype: "device" },
    },
  ] as any[];

  const groupedLights = [{ id: "grouped-room-1", on: { on: true } }] as any[];

  const rooms = [
    {
      children: [{ rid: "device-1", rtype: "device" }],
      id: "room-1",
      metadata: { archetype: "office", name: "Office" },
      services: [{ rid: "grouped-room-1", rtype: "grouped_light" }],
    },
  ] as any[];

  const scenes = [
    {
      group: { rid: "room-1", rtype: "room" },
      id: "scene-1",
      metadata: { name: "Concentrate" },
      status: { active: "inactive" },
    },
  ] as any[];

  return { devices, groupedLights, lights, rooms, scenes, zones: [] as any[] };
}

function createFetchStub(fixture = createFixture()) {
  const requests: RequestLog[] = [];

  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const body = await readRequestJson(request);
    requests.push({
      body,
      headers: Object.fromEntries(request.headers.entries()),
      method: request.method,
      url: url.pathname,
    });

    switch (`${request.method} ${url.pathname}`) {
      case "GET /clip/v2/resource/device":
        return jsonResponse({ data: fixture.devices, errors: [] });
      case "GET /clip/v2/resource/grouped_light":
        return jsonResponse({ data: fixture.groupedLights, errors: [] });
      case "GET /clip/v2/resource/light":
        return jsonResponse({ data: fixture.lights, errors: [] });
      case "GET /clip/v2/resource/room":
        return jsonResponse({ data: fixture.rooms, errors: [] });
      case "GET /clip/v2/resource/scene":
        return jsonResponse({ data: fixture.scenes, errors: [] });
      case "GET /clip/v2/resource/zone":
        return jsonResponse({ data: fixture.zones, errors: [] });
      case "PUT /clip/v2/resource/light/light-1":
        return jsonResponse({ data: [{ rid: "light-1", rtype: "light" }], errors: [] });
      default:
        throw new Error(`Unhandled request: ${request.method} ${url.pathname}`);
    }
  };

  return { fetch, requests };
}

const servers: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function startHttpServer(server: ReturnType<typeof createHueMcpHttpServer>) {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as AddressInfo;
  servers.push({
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  });
  return `http://127.0.0.1:${address.port}/mcp`;
}

describe("Hue MCP server", () => {
  it("advertises tool capabilities during initialize", async () => {
    const server = new HueMcpServer();

    const response = await server.handleMessage({
      id: 1,
      jsonrpc: "2.0",
      method: "initialize",
      params: { protocolVersion: "2025-03-26" },
    });

    expect(response).toEqual({
      id: 1,
      jsonrpc: "2.0",
      result: {
        capabilities: { tools: {} },
        protocolVersion: "2025-03-26",
        serverInfo: {
          name: "newhue-client",
          version: expect.any(String),
        },
      },
    });
  });

  it("lists the MCP tools exposed by the Hue server", async () => {
    const server = new HueMcpServer();

    const response = await server.handleMessage({
      id: 2,
      jsonrpc: "2.0",
      method: "tools/list",
    });

    expect(response?.result).toMatchObject({
      tools: expect.arrayContaining([
        expect.objectContaining({ name: "get_status" }),
        expect.objectContaining({ name: "set_light_state" }),
        expect.objectContaining({ name: "recall_scene" }),
      ]),
    });
  });

  it("executes get_status through the same bridge config used by the CLI", async () => {
    const keychain = createKeychain({ default: { applicationKey: "stored-app-key" } });
    const { fetch } = createFetchStub();
    const server = new HueMcpServer(
      {
        env: { HUE_BRIDGE_URL: "https://bridge.local" },
        fetch,
        keychain,
      },
      {},
    );

    const response = await server.handleMessage({
      id: 3,
      jsonrpc: "2.0",
      method: "tools/call",
      params: { arguments: {}, name: "get_status" },
    });

    expect(response?.result).toMatchObject({
      structuredContent: {
        applicationKeyConfigured: true,
        bridgeUrl: "https://bridge.local",
        counts: { lights: 1, rooms: 1, scenes: 1, zones: 0 },
      },
    });
  });

  it("returns MCP tool errors without crashing the session", async () => {
    const keychain = createKeychain({ default: { applicationKey: "stored-app-key" } });
    const { fetch, requests } = createFetchStub();
    const server = new HueMcpServer(
      {
        env: { HUE_BRIDGE_URL: "https://bridge.local" },
        fetch,
        keychain,
      },
      {},
    );

    const response = await server.handleMessage({
      id: 4,
      jsonrpc: "2.0",
      method: "tools/call",
      params: { arguments: { target: "Desk Lamp" }, name: "set_light_state" },
    });

    expect(response?.result).toMatchObject({
      content: [expect.objectContaining({ text: expect.stringContaining("Provide at least one state field") })],
      isError: true,
    });
    expect(requests.filter((entry) => entry.method === "PUT")).toHaveLength(0);
  });

  it("exposes the HTTP MCP endpoint with API key auth and forwards Hue app keys from headers", async () => {
    const keychain = createKeychain({ default: { applicationKey: "stored-app-key" } });
    const { fetch, requests } = createFetchStub();
    const server = createHueMcpHttpServer(
      {
        apiKey: "mcp-secret",
        transport: "http",
      },
      {
        env: { HUE_BRIDGE_URL: "https://bridge.local" },
        fetch,
        keychain,
      },
    );
    const endpoint = await startHttpServer(server);

    const response = await globalThis.fetch(endpoint, {
      body: JSON.stringify({
        id: 5,
        jsonrpc: "2.0",
        method: "tools/call",
        params: { arguments: {}, name: "get_status" },
      }),
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: "Bearer mcp-secret",
        "Content-Type": "application/json",
        "Hue-Application-Key": "header-app-key",
      },
      method: "POST",
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      result: {
        structuredContent: {
          applicationKeyConfigured: true,
          bridgeUrl: "https://bridge.local",
        },
      },
    });
    expect(requests[0]?.headers["hue-application-key"]).toBe("header-app-key");
  });

  it("rejects unauthorized HTTP MCP requests", async () => {
    const keychain = createKeychain({ default: { applicationKey: "stored-app-key" } });
    const { fetch } = createFetchStub();
    const server = createHueMcpHttpServer(
      {
        apiKey: "mcp-secret",
        transport: "http",
      },
      {
        env: { HUE_BRIDGE_URL: "https://bridge.local" },
        fetch,
        keychain,
      },
    );
    const endpoint = await startHttpServer(server);

    const response = await globalThis.fetch(endpoint, {
      body: JSON.stringify({ id: 6, jsonrpc: "2.0", method: "tools/list" }),
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    expect(response.status).toBe(401);
  });
});
