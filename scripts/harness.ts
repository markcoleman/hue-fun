import { resolve } from "node:path";

import {
  authenticate,
  createHueClient,
  discoverHueBridges,
} from "../src/index";
import type {
  DeviceGet,
  LightGet,
  ResourceIdentifier,
  RoomGet,
} from "../src/generated";
import { type GeneratedFieldsResult } from "../src/internal/api";
import {
  createDebugFetch,
  enableInsecureTls,
  formatError,
  isCertificateFailure,
} from "../src/internal/bridge-runtime";
import { loadDotEnvFile } from "../src/internal/dotenv";
const DOT_ENV_PATH = resolve(process.cwd(), ".env");

type LightTableRow = {
  location: string;
  name: string;
  state: string;
};
loadDotEnvFile(DOT_ENV_PATH);

function parseArgs(argv: string[]): { flags: Map<string, string | boolean>; positionals: string[] } {
  const flags = new Map<string, string | boolean>();
  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      flags.set(key, true);
      continue;
    }

    flags.set(key, next);
    index += 1;
  }

  return { flags, positionals };
}

function getFlag(flags: Map<string, string | boolean>, name: string): string | undefined {
  const value = flags.get(name);
  return typeof value === "string" ? value : undefined;
}

function requireWriteFlag(flags: Map<string, string | boolean>): void {
  if (flags.get("write") !== true) {
    throw new Error("State-changing commands require the --write flag.");
  }
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function createClientFromEnv(flags: Map<string, string | boolean>) {
  const bridgeUrl = process.env.HUE_BRIDGE_URL;
  const applicationKey = process.env.HUE_APP_KEY;

  if (!bridgeUrl || !applicationKey) {
    throw new Error("HUE_BRIDGE_URL and HUE_APP_KEY must be set.");
  }

  enableInsecureTls({ secureTls: flags.get("secure-tls") === true });

  const clientKey = process.env.HUE_CLIENT_KEY;
  const debugFetch = createDebugFetch(
    { debugHttp: flags.get("debug-http") === true },
    process.env,
    globalThis.fetch,
    (line) => console.error(line.replace(/^\[hue\]/, "[harness]")),
  );

  return createHueClient({
    applicationKey,
    bridgeUrl,
    ...(clientKey ? { clientKey } : {}),
    ...(debugFetch ? { fetch: debugFetch } : {}),
    userAgent: "newhue-client-harness/0.1.0",
  });
}

function printTlsHint(command: string | undefined): void {
  if (command === "discover") {
    return;
  }

  console.error(
    [
      "TLS verification failed.",
      "The harness defaults to insecure TLS for local Hue bridges.",
      "If you want full certificate verification, rerun with `--secure-tls` and install the bridge CA locally.",
    ].join(" "),
  );
}

function unwrapRawData<T>(result: GeneratedFieldsResult<{ data?: T[] }>, operation: string): T[] {
  if (result.error !== undefined) {
    throw result.error instanceof Error ? result.error : new Error(`${operation} failed.`);
  }
  return result.data?.data ?? [];
}

function locationLabel(roomName: string | undefined, zones: string[]): string {
  if (!roomName && zones.length === 0) {
    return "-";
  }
  if (!roomName) {
    return zones.join(", ");
  }
  if (zones.length === 0) {
    return roomName;
  }
  return `${roomName} | ${zones.join(", ")}`;
}

function buildLocationMap(resources: RoomGet[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const resource of resources) {
    const name = resource.metadata.name;
    for (const child of resource.children) {
      map.set(child.rid, name);
    }
    for (const service of resource.services) {
      map.set(service.rid, name);
    }
  }
  return map;
}

function buildZoneMap(resources: RoomGet[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const resource of resources) {
    const name = resource.metadata.name;
    const refs: ResourceIdentifier[] = [...resource.children, ...resource.services];
    for (const ref of refs) {
      const current = map.get(ref.rid) ?? [];
      if (!current.includes(name)) {
        current.push(name);
      }
      map.set(ref.rid, current);
    }
  }
  return map;
}

function formatLightRows(lights: LightGet[], devices: DeviceGet[], rooms: RoomGet[], zones: RoomGet[]): LightTableRow[] {
  const deviceNameById = new Map(devices.map((device) => [device.id, device.metadata.name]));
  const roomByRid = buildLocationMap(rooms);
  const zoneByRid = buildZoneMap(zones);

  return lights
    .map((light) => {
      const deviceId = light.owner.rid;
      const name = deviceNameById.get(deviceId) ?? light.metadata?.name ?? light.id;
      const roomName = roomByRid.get(deviceId) ?? roomByRid.get(light.id);
      const zonesForLight = [
        ...(zoneByRid.get(deviceId) ?? []),
        ...(zoneByRid.get(light.id) ?? []),
      ].filter((value, index, array) => array.indexOf(value) === index);

      return {
        location: locationLabel(roomName, zonesForLight),
        name,
        state: light.on.on ? "on" : "off",
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function printTable(rows: LightTableRow[]): void {
  if (rows.length === 0) {
    console.log("No lights found.");
    return;
  }

  const headers: Array<keyof LightTableRow> = ["name", "location", "state"];
  const labels: Record<keyof LightTableRow, string> = {
    location: "Location/Zone",
    name: "Light",
    state: "State",
  };

  const widths = new Map<keyof LightTableRow, number>();
  for (const header of headers) {
    const maxRowWidth = Math.max(...rows.map((row) => row[header].length));
    widths.set(header, Math.max(labels[header].length, maxRowWidth));
  }

  const renderRow = (row: Record<keyof LightTableRow, string>) =>
    headers
      .map((header) => row[header].padEnd(widths.get(header) ?? 0))
      .join("  ");

  console.log(renderRow(labels));
  console.log(headers.map((header) => "-".repeat(widths.get(header) ?? 0)).join("  "));
  for (const row of rows) {
    console.log(renderRow(row));
  }
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const { flags, positionals } = parseArgs(rest);

  switch (command) {
    case "discover": {
      printJson(await discoverHueBridges());
      return;
    }
    case "auth": {
      const bridgeUrl = getFlag(flags, "bridge-url") ?? process.env.HUE_BRIDGE_URL;
      const deviceType = getFlag(flags, "device-type") ?? process.env.HUE_DEVICE_TYPE ?? "codex#newhue-client";
      enableInsecureTls({ secureTls: flags.get("secure-tls") === true });
      const debugFetch = createDebugFetch(
        { debugHttp: flags.get("debug-http") === true },
        process.env,
        globalThis.fetch,
        (line) => console.error(line.replace(/^\[hue\]/, "[harness]")),
      );
      if (!bridgeUrl) {
        throw new Error("Provide --bridge-url or set HUE_BRIDGE_URL.");
      }
      printJson(
        await authenticate({
          bridgeUrl,
          deviceType,
          generateClientKey: flags.get("client-key") === true,
          ...(debugFetch ? { fetch: debugFetch } : {}),
          userAgent: "newhue-client-harness/0.1.0",
        }),
      );
      return;
    }
    case "list-lights": {
      const client = createClientFromEnv(flags);
      const lights = await client.lights.list();
      if (flags.get("json") === true) {
        printJson(lights);
        return;
      }

      const [devicesResult, roomsResult, zonesResult] = await Promise.all([
        client.raw.getDevices() as Promise<GeneratedFieldsResult<{ data?: DeviceGet[] }>>,
        client.raw.getRooms() as Promise<GeneratedFieldsResult<{ data?: RoomGet[] }>>,
        client.raw.getZones() as Promise<GeneratedFieldsResult<{ data?: RoomGet[] }>>,
      ]);
      const devices = unwrapRawData(devicesResult, "getDevices");
      const rooms = unwrapRawData(roomsResult, "getRooms");
      const zones = unwrapRawData(zonesResult, "getZones");

      printTable(formatLightRows(lights, devices, rooms, zones));
      return;
    }
    case "get-light": {
      const client = createClientFromEnv(flags);
      const lightId = positionals[0];
      if (!lightId) {
        throw new Error("Usage: npm run harness -- get-light <lightId>");
      }
      printJson(await client.lights.get(lightId));
      return;
    }
    case "toggle": {
      requireWriteFlag(flags);
      const client = createClientFromEnv(flags);
      const lightId = positionals[0];
      const state = positionals[1];
      if (!lightId || (state !== "on" && state !== "off")) {
        throw new Error("Usage: npm run harness -- toggle <lightId> <on|off> --write");
      }
      printJson(state === "on" ? await client.lights.on(lightId) : await client.lights.off(lightId));
      return;
    }
    case "brightness": {
      requireWriteFlag(flags);
      const client = createClientFromEnv(flags);
      const lightId = positionals[0];
      const brightnessValue = positionals[1];
      if (!lightId || !brightnessValue) {
        throw new Error("Usage: npm run harness -- brightness <lightId> <brightness> --write");
      }
      const brightness = Number(brightnessValue);
      if (!Number.isFinite(brightness)) {
        throw new Error("Brightness must be a number.");
      }
      printJson(await client.lights.setBrightness(lightId, brightness));
      return;
    }
    case "scene-recall": {
      requireWriteFlag(flags);
      const client = createClientFromEnv(flags);
      const sceneId = positionals[0];
      const action = positionals[1];
      if (!sceneId) {
        throw new Error("Usage: npm run harness -- scene-recall <sceneId> [active|dynamic_palette|static] --write");
      }
      printJson(
        await client.scenes.recall(
          sceneId,
          action ? { action: action as "active" | "dynamic_palette" | "static" } : undefined,
        ),
      );
      return;
    }
    case "stream-events": {
      const client = createClientFromEnv(flags);
      const since = getFlag(flags, "since");
      const limit = Number(getFlag(flags, "limit") ?? "0");
      let seen = 0;
      for await (const message of client.events.stream(since ? { since } : undefined)) {
        printJson(message);
        seen += 1;
        if (limit > 0 && seen >= limit) {
          break;
        }
      }
      return;
    }
    default: {
      throw new Error(
        [
          "Usage:",
          "  npm run harness -- discover",
          "  npm run harness -- auth --bridge-url https://<bridge-ip> [--device-type app#instance] [--client-key] [--secure-tls] [--debug-http]",
          "  npm run harness -- list-lights [--json] [--secure-tls] [--debug-http]",
          "  npm run harness -- get-light <lightId> [--secure-tls] [--debug-http]",
          "  npm run harness -- toggle <lightId> <on|off> --write [--secure-tls] [--debug-http]",
          "  npm run harness -- brightness <lightId> <brightness> --write [--secure-tls] [--debug-http]",
          "  npm run harness -- scene-recall <sceneId> [active|dynamic_palette|static] --write [--secure-tls] [--debug-http]",
          "  npm run harness -- stream-events [--since 1770336203:0] [--limit 5] [--secure-tls] [--debug-http]",
        ].join("\n"),
      );
    }
  }
}

main().catch((error) => {
  console.error(formatError(error));
  if (isCertificateFailure(error)) {
    printTlsHint(process.argv[2]);
  }
  process.exitCode = 1;
});
