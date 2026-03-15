import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runHueCli } from "../../src/cli/app";
import type { SecretStore, StoredSecrets } from "../../src/cli/types";
import { jsonResponse, readRequestJson } from "./helpers";

type RequestLog = {
  body: unknown;
  method: string;
  url: string;
};

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "openhue-cli-"));
}

function createKeychain(initial: Record<string, StoredSecrets> = {}): SecretStore & { values: Map<string, StoredSecrets> } {
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
    values,
  };
}

function createFixture(options: { duplicateLights?: boolean } = {}) {
  const devices = [
    {
      id: "device-1",
      metadata: { name: options.duplicateLights ? "Lamp" : "Desk Lamp" },
      services: [{ rid: "light-1", rtype: "light" }],
    },
    {
      id: "device-2",
      metadata: { name: options.duplicateLights ? "Lamp" : "Floor Lamp" },
      services: [{ rid: "light-2", rtype: "light" }],
    },
  ] as any[];

  const lights = [
    {
      dimming: { brightness: 41 },
      id: "light-1",
      metadata: { name: devices[0]!.metadata.name },
      on: { on: true },
      owner: { rid: "device-1", rtype: "device" },
    },
    {
      dimming: { brightness: 12 },
      id: "light-2",
      metadata: { name: devices[1]!.metadata.name },
      on: { on: false },
      owner: { rid: "device-2", rtype: "device" },
    },
  ] as any[];

  const groupedLights = [
    { id: "grouped-room-1", on: { on: true } },
    { id: "grouped-zone-1", on: { on: false } },
  ] as any[];

  const rooms = [
    {
      children: [{ rid: "device-1", rtype: "device" }],
      id: "room-1",
      metadata: { archetype: "office", name: "Office" },
      services: [{ rid: "grouped-room-1", rtype: "grouped_light" }],
    },
  ] as any[];

  const zones = [
    {
      children: [
        { rid: "device-1", rtype: "device" },
        { rid: "device-2", rtype: "device" },
      ],
      id: "zone-1",
      metadata: { archetype: "office", name: "Focus Zone" },
      services: [{ rid: "grouped-zone-1", rtype: "grouped_light" }],
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

  return { devices, groupedLights, lights, rooms, scenes, zones };
}

function createFetchStub(fixture = createFixture()) {
  const requests: RequestLog[] = [];

  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const body = await readRequestJson(request);
    requests.push({ body, method: request.method, url: url.pathname });

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
      case "POST /api":
        return jsonResponse([{ success: { username: "auth-app-key", clientkey: "auth-client-key" } }]);
      case "PUT /clip/v2/resource/grouped_light/grouped-room-1":
        return jsonResponse({ data: [{ rid: "grouped-room-1", rtype: "grouped_light" }], errors: [] });
      case "PUT /clip/v2/resource/grouped_light/grouped-zone-1":
        return jsonResponse({ data: [{ rid: "grouped-zone-1", rtype: "grouped_light" }], errors: [] });
      case "PUT /clip/v2/resource/light/light-1":
        return jsonResponse({ data: [{ rid: "light-1", rtype: "light" }], errors: [] });
      case "PUT /clip/v2/resource/room/room-1":
        return jsonResponse({ data: [{ rid: "room-1", rtype: "room" }], errors: [] });
      case "PUT /clip/v2/resource/zone/zone-1":
        return jsonResponse({ data: [{ rid: "zone-1", rtype: "zone" }], errors: [] });
      default:
        throw new Error(`Unhandled request: ${request.method} ${url.pathname}`);
    }
  };

  return { fetch, requests };
}

async function runCli(argv: string[], options: {
  cwd?: string;
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  keychain?: SecretStore;
  stdinIsTTY?: boolean;
  stdoutIsTTY?: boolean;
} = {}) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCode = await runHueCli(argv, {
    cwd: options.cwd,
    env: options.env,
    fetch: options.fetch,
    keychain: options.keychain,
    stderr: (line) => stderr.push(line),
    stdinIsTTY: options.stdinIsTTY ?? false,
    stdout: (line) => stdout.push(line),
    stdoutIsTTY: options.stdoutIsTTY ?? false,
  });

  return {
    exitCode,
    stderr: stderr.join("\n"),
    stdout: stdout.join("\n"),
  };
}

describe("hue CLI", () => {
  it("loads bridge settings from .env and application key from keychain", async () => {
    const cwd = createTempDir();
    writeFileSync(join(cwd, ".env"), "HUE_BRIDGE_URL=https://bridge.local\n", "utf8");
    const keychain = createKeychain({ default: { applicationKey: "stored-app-key" } });
    const { fetch } = createFetchStub();

    const result = await runCli(["status", "--json"], { cwd, fetch, keychain });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      bridgeUrl: "https://bridge.local",
      counts: { lights: 2, rooms: 1, scenes: 1, zones: 1 },
      profile: "default",
    });
  });

  it("fails when a light name is ambiguous in non-interactive mode", async () => {
    const cwd = createTempDir();
    const keychain = createKeychain({ default: { applicationKey: "stored-app-key" } });
    const { fetch } = createFetchStub(createFixture({ duplicateLights: true }));

    const result = await runCli(["lights", "get", "Lamp", "--bridge-url", "https://bridge.local"], {
      cwd,
      fetch,
      keychain,
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Ambiguous light");
  });

  it("prints ANSI-colored human light tables when stdout is a TTY", async () => {
    const cwd = createTempDir();
    const keychain = createKeychain({ default: { applicationKey: "stored-app-key" } });
    const { fetch } = createFetchStub();

    const result = await runCli(["lights", "list", "--bridge-url", "https://bridge.local"], {
      cwd,
      env: {},
      fetch,
      keychain,
      stdoutIsTTY: true,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Light");
    expect(result.stdout).toContain("\u001b[");
  });

  it("sends the expected light payload for lights set", async () => {
    const cwd = createTempDir();
    const keychain = createKeychain({ default: { applicationKey: "stored-app-key" } });
    const { fetch, requests } = createFetchStub();

    const result = await runCli(
      ["lights", "set", "light-1", "--bridge-url", "https://bridge.local", "--brightness", "55", "--on"],
      { cwd, fetch, keychain },
    );

    expect(result.exitCode).toBe(0);
    const request = requests.find((entry) => entry.url === "/clip/v2/resource/light/light-1" && entry.method === "PUT");
    expect(request?.body).toEqual({
      dimming: { brightness: 55 },
      on: { on: true },
    });
  });

  it("routes room state changes through the grouped light service", async () => {
    const cwd = createTempDir();
    const keychain = createKeychain({ default: { applicationKey: "stored-app-key" } });
    const { fetch, requests } = createFetchStub();

    const result = await runCli(
      ["rooms", "set", "Office", "--bridge-url", "https://bridge.local", "--brightness", "20"],
      { cwd, fetch, keychain },
    );

    expect(result.exitCode).toBe(0);
    const request = requests.find(
      (entry) => entry.url === "/clip/v2/resource/grouped_light/grouped-room-1" && entry.method === "PUT",
    );
    expect(request?.body).toEqual({
      dimming: { brightness: 20 },
    });
  });

  it("preserves existing room members when adding devices", async () => {
    const cwd = createTempDir();
    const keychain = createKeychain({ default: { applicationKey: "stored-app-key" } });
    const { fetch, requests } = createFetchStub();

    const result = await runCli(["rooms", "add", "Office", "device-2", "--bridge-url", "https://bridge.local"], {
      cwd,
      fetch,
      keychain,
    });

    expect(result.exitCode).toBe(0);
    const request = requests.find((entry) => entry.url === "/clip/v2/resource/room/room-1" && entry.method === "PUT");
    expect(request?.body).toEqual({
      children: [
        { rid: "device-1", rtype: "device" },
        { rid: "device-2", rtype: "device" },
      ],
      metadata: { archetype: "office", name: "Office" },
    });
  });

  it("replaces zone members during assign", async () => {
    const cwd = createTempDir();
    const keychain = createKeychain({ default: { applicationKey: "stored-app-key" } });
    const { fetch, requests } = createFetchStub();

    const result = await runCli(
      ["zones", "assign", "Focus Zone", "device-2", "--bridge-url", "https://bridge.local", "--yes"],
      { cwd, fetch, keychain },
    );

    expect(result.exitCode).toBe(0);
    const request = requests.find((entry) => entry.url === "/clip/v2/resource/zone/zone-1" && entry.method === "PUT");
    expect(request?.body).toEqual({
      children: [{ rid: "device-2", rtype: "device" }],
      metadata: { archetype: "office", name: "Focus Zone" },
    });
  });

  it("writes bridge metadata but skips keychain persistence for auth --no-save", async () => {
    const cwd = createTempDir();
    const configPath = join(cwd, "config.yaml");
    const keychain = createKeychain();
    const { fetch } = createFetchStub();

    const result = await runCli(["auth", "--bridge-url", "https://bridge.local", "--config", configPath, "--no-save"], {
      cwd,
      fetch,
      keychain,
    });

    expect(result.exitCode).toBe(0);
    expect(keychain.values.size).toBe(0);
    expect(readFileSync(configPath, "utf8")).toContain("bridgeUrl: https://bridge.local");
  });

  it("runs workflows in dry-run mode without sending write requests", async () => {
    const cwd = createTempDir();
    const configPath = join(cwd, "config.yaml");
    writeFileSync(
      configPath,
      [
        "defaultProfile: default",
        "profiles:",
        "  default:",
        "    bridgeUrl: https://bridge.local",
        "    workflows:",
        "      movie-time:",
        "        description: test workflow",
        "        steps:",
        "          - kind: room.set",
        "            targetId: room-1",
        "            brightness: 15",
        "          - kind: scene.recall",
        "            targetId: scene-1",
      ].join("\n"),
      "utf8",
    );
    const keychain = createKeychain({ default: { applicationKey: "stored-app-key" } });
    const { fetch, requests } = createFetchStub();

    const result = await runCli(["workflow", "run", "movie-time", "--dry-run", "--json", "--config", configPath], {
      cwd,
      fetch,
      keychain,
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      executed: [
        { kind: "room.set", targetId: "room-1" },
        { kind: "scene.recall", targetId: "scene-1" },
      ],
      name: "movie-time",
    });
    expect(requests.some((entry) => entry.method === "PUT")).toBe(false);
  });
});
