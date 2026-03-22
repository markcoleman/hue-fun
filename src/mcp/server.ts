import { createInterface } from "node:readline";

const packageVersion = "0.1.0";

import type { ScenePut } from "../generated/types.gen";
import { formatError } from "../internal/bridge-runtime";
import { createCliHueClient, loadInventory, applyGroupState, applyLightState, recallScene, resolveGroup, resolveLight, resolveScene } from "../cli/hue-service";
import { createKeychainStore } from "../cli/keychain";
import { resolveCliSettings } from "../cli/config";
import type { CliDependencies, GlobalCliOptions } from "../cli/types";
import { HueCliError } from "../cli/types";

type JsonRpcId = number | string | null;
type JsonObject = Record<string, unknown>;
type JsonRpcRequest = {
  id?: JsonRpcId;
  jsonrpc?: string;
  method?: string;
  params?: unknown;
};

type ToolDefinition = {
  description: string;
  inputSchema: JsonObject;
  name: string;
};

type ToolHandler = (args: JsonObject, deps: CliDependencies, options: GlobalCliOptions) => Promise<unknown>;

type Transport = {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
};

const SUPPORTED_PROTOCOL_VERSIONS = ["2025-03-26", "2024-11-05"] as const;

const toolDefinitions: ToolDefinition[] = [
  {
    name: "get_status",
    description: "Return the configured Hue bridge, profile, and inventory counts.",
    inputSchema: { additionalProperties: false, properties: {}, type: "object" },
  },
  {
    name: "list_lights",
    description: "List Hue lights with IDs, names, location labels, brightness, and on/off state.",
    inputSchema: { additionalProperties: false, properties: {}, type: "object" },
  },
  {
    name: "get_light",
    description: "Get a light by exact ID or case-insensitive exact name.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        target: { description: "The Hue light ID or exact light name.", minLength: 1, type: "string" },
      },
      required: ["target"],
      type: "object",
    },
  },
  {
    name: "set_light_state",
    description: "Update a Hue light by ID or exact name.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        brightness: { description: "Brightness percentage.", type: "number" },
        mirek: { description: "Color temperature in mirek.", type: "number" },
        on: { description: "Turn the light on or off.", type: "boolean" },
        target: { description: "The Hue light ID or exact light name.", minLength: 1, type: "string" },
        transitionMs: { description: "Transition duration in milliseconds.", type: "number" },
        xy: {
          additionalProperties: false,
          properties: {
            x: { type: "number" },
            y: { type: "number" },
          },
          required: ["x", "y"],
          type: "object",
        },
      },
      required: ["target"],
      type: "object",
    },
  },
  {
    name: "list_rooms",
    description: "List Hue rooms with IDs, archetypes, light counts, and aggregated on/off state.",
    inputSchema: { additionalProperties: false, properties: {}, type: "object" },
  },
  {
    name: "set_room_state",
    description: "Update a Hue room by ID or exact name.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        brightness: { type: "number" },
        mirek: { type: "number" },
        on: { type: "boolean" },
        target: { description: "The Hue room ID or exact room name.", minLength: 1, type: "string" },
        transitionMs: { type: "number" },
        xy: {
          additionalProperties: false,
          properties: {
            x: { type: "number" },
            y: { type: "number" },
          },
          required: ["x", "y"],
          type: "object",
        },
      },
      required: ["target"],
      type: "object",
    },
  },
  {
    name: "list_zones",
    description: "List Hue zones with IDs, archetypes, light counts, and aggregated on/off state.",
    inputSchema: { additionalProperties: false, properties: {}, type: "object" },
  },
  {
    name: "set_zone_state",
    description: "Update a Hue zone by ID or exact name.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        brightness: { type: "number" },
        mirek: { type: "number" },
        on: { type: "boolean" },
        target: { description: "The Hue zone ID or exact zone name.", minLength: 1, type: "string" },
        transitionMs: { type: "number" },
        xy: {
          additionalProperties: false,
          properties: {
            x: { type: "number" },
            y: { type: "number" },
          },
          required: ["x", "y"],
          type: "object",
        },
      },
      required: ["target"],
      type: "object",
    },
  },
  {
    name: "list_scenes",
    description: "List Hue scenes with IDs, names, and the room or zone they belong to.",
    inputSchema: { additionalProperties: false, properties: {}, type: "object" },
  },
  {
    name: "recall_scene",
    description: "Recall a Hue scene by ID or exact name.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        action: { enum: ["active", "dynamic_palette", "static"], type: "string" },
        duration: { description: "Transition duration in milliseconds.", type: "number" },
        target: { description: "The Hue scene ID or exact scene name.", minLength: 1, type: "string" },
      },
      required: ["target"],
      type: "object",
    },
  },
];

function toJsonObject(value: unknown): JsonObject {
  if (value === undefined) {
    return {};
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HueCliError("MCP tool arguments must be a JSON object.", { exitCode: 2 });
  }
  return value as JsonObject;
}

function requireString(args: JsonObject, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new HueCliError(`Expected a non-empty string for \`${key}\`.`, { exitCode: 2 });
  }
  return value;
}

function optionalNumber(args: JsonObject, key: string): number | undefined {
  const value = args[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new HueCliError(`Expected a finite number for \`${key}\`.`, { exitCode: 2 });
  }
  return value;
}

function optionalBoolean(args: JsonObject, key: string): boolean | undefined {
  const value = args[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new HueCliError(`Expected a boolean for \`${key}\`.`, { exitCode: 2 });
  }
  return value;
}

function optionalXY(args: JsonObject): { x: number; y: number } | undefined {
  const value = args.xy;
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HueCliError("Expected `xy` to be an object with numeric x and y values.", { exitCode: 2 });
  }
  const { x, y } = value as Record<string, unknown>;
  if (typeof x !== "number" || !Number.isFinite(x) || typeof y !== "number" || !Number.isFinite(y)) {
    throw new HueCliError("Expected `xy` to contain finite numeric x and y values.", { exitCode: 2 });
  }
  return { x, y };
}

function buildState(args: JsonObject) {
  const state = {
    brightness: optionalNumber(args, "brightness"),
    colorTemperatureMirek: optionalNumber(args, "mirek"),
    on: optionalBoolean(args, "on"),
    transitionMs: optionalNumber(args, "transitionMs"),
    xy: optionalXY(args),
  };

  if (
    state.brightness === undefined &&
    state.colorTemperatureMirek === undefined &&
    state.on === undefined &&
    state.transitionMs === undefined &&
    state.xy === undefined
  ) {
    throw new HueCliError("Provide at least one state field to update.", { exitCode: 2 });
  }

  return state;
}

async function resolveMcpSettings(deps: CliDependencies, options: GlobalCliOptions) {
  const keychain = deps.keychain ?? createKeychainStore();
  return resolveCliSettings(options, { ...deps, keychain, stdinIsTTY: false, stdoutIsTTY: false });
}

async function withClient<T>(deps: CliDependencies, options: GlobalCliOptions, operation: (client: ReturnType<typeof createCliHueClient>) => Promise<T>) {
  const settings = await resolveMcpSettings(deps, options);
  const client = createCliHueClient(settings, deps);
  return operation(client);
}

const toolHandlers: Record<string, ToolHandler> = {
  async get_status(_args, deps, options) {
    const settings = await resolveMcpSettings(deps, options);
    if (!settings.bridgeUrl || !settings.applicationKey) {
      return {
        applicationKeyConfigured: Boolean(settings.applicationKey),
        bridgeUrl: settings.bridgeUrl ?? null,
        configPath: settings.configPath,
        profile: settings.profile.name,
      };
    }

    return withClient(deps, options, async (client) => {
      const inventory = await loadInventory(client);
      return {
        applicationKeyConfigured: true,
        bridgeUrl: client.bridgeUrl,
        counts: {
          lights: inventory.lights.length,
          rooms: inventory.rooms.length,
          scenes: inventory.scenes.length,
          zones: inventory.zones.length,
        },
        profile: settings.profile.name,
      };
    });
  },
  async list_lights(_args, deps, options) {
    return withClient(deps, options, async (client) => {
      const inventory = await loadInventory(client);
      return inventory.lights.map((light) => ({
        brightness: light.brightness,
        deviceId: light.deviceId,
        id: light.id,
        location: light.location,
        name: light.name,
        on: light.on,
        roomName: light.roomName,
        zones: light.zones,
      }));
    });
  },
  async get_light(args, deps, options) {
    return withClient(deps, options, async (client) => {
      const inventory = await loadInventory(client);
      const light = await resolveLight(inventory, requireString(args, "target"));
      return {
        brightness: light.brightness,
        deviceId: light.deviceId,
        id: light.id,
        location: light.location,
        name: light.name,
        on: light.on,
        raw: light.raw,
        roomName: light.roomName,
        zones: light.zones,
      };
    });
  },
  async set_light_state(args, deps, options) {
    return withClient(deps, options, async (client) => {
      const inventory = await loadInventory(client);
      const light = await resolveLight(inventory, requireString(args, "target"));
      const state = buildState(args);
      const result = await applyLightState(client, light.id, state);
      return { result, state, target: { id: light.id, name: light.name } };
    });
  },
  async list_rooms(_args, deps, options) {
    return withClient(deps, options, async (client) => {
      const inventory = await loadInventory(client);
      return inventory.rooms.map((room) => ({
        archetype: room.archetype,
        deviceIds: room.deviceIds,
        groupedLightId: room.groupedLightId,
        id: room.id,
        lightIds: room.lightIds,
        lights: room.lightIds.length,
        members: room.deviceIds.length,
        name: room.name,
        on: room.on,
      }));
    });
  },
  async set_room_state(args, deps, options) {
    return withClient(deps, options, async (client) => {
      const inventory = await loadInventory(client);
      const room = await resolveGroup(inventory, "room", requireString(args, "target"));
      const state = buildState(args);
      const result = await applyGroupState(client, room, state);
      return { result, state, target: { id: room.id, name: room.name } };
    });
  },
  async list_zones(_args, deps, options) {
    return withClient(deps, options, async (client) => {
      const inventory = await loadInventory(client);
      return inventory.zones.map((zone) => ({
        archetype: zone.archetype,
        deviceIds: zone.deviceIds,
        groupedLightId: zone.groupedLightId,
        id: zone.id,
        lightIds: zone.lightIds,
        lights: zone.lightIds.length,
        members: zone.deviceIds.length,
        name: zone.name,
        on: zone.on,
      }));
    });
  },
  async set_zone_state(args, deps, options) {
    return withClient(deps, options, async (client) => {
      const inventory = await loadInventory(client);
      const zone = await resolveGroup(inventory, "zone", requireString(args, "target"));
      const state = buildState(args);
      const result = await applyGroupState(client, zone, state);
      return { result, state, target: { id: zone.id, name: zone.name } };
    });
  },
  async list_scenes(_args, deps, options) {
    return withClient(deps, options, async (client) => {
      const inventory = await loadInventory(client);
      const groupNames = new Map<string, string>();
      for (const room of inventory.rooms) {
        groupNames.set(room.id, room.name);
      }
      for (const zone of inventory.zones) {
        groupNames.set(zone.id, zone.name);
      }
      return inventory.scenes.map((scene) => ({
        groupId: scene.groupId,
        groupName: groupNames.get(scene.groupId) ?? scene.groupId,
        id: scene.id,
        name: scene.name,
      }));
    });
  },
  async recall_scene(args, deps, options) {
    return withClient(deps, options, async (client) => {
      const inventory = await loadInventory(client);
      const scene = await resolveScene(inventory, requireString(args, "target"));
      const action = args.action;
      if (action !== undefined && action !== "active" && action !== "dynamic_palette" && action !== "static") {
        throw new HueCliError("Expected `action` to be one of active, dynamic_palette, or static.", { exitCode: 2 });
      }
      const duration = optionalNumber(args, "duration");
      const recall: NonNullable<ScenePut["recall"]> = {
        ...(action ? { action } : {}),
        ...(duration !== undefined ? { duration } : {}),
      };
      const result = await recallScene(client, scene, recall);
      return { recall, result, target: { id: scene.id, name: scene.name } };
    });
  },
};

function successResponse(id: JsonRpcId, result: unknown) {
  return { id, jsonrpc: "2.0", result };
}

function errorResponse(id: JsonRpcId, code: number, message: string, data?: unknown) {
  return {
    error: {
      code,
      ...(data === undefined ? {} : { data }),
      message,
    },
    id,
    jsonrpc: "2.0",
  };
}

function formatToolResult(payload: unknown) {
  return {
    content: [
      {
        text: JSON.stringify(payload, null, 2),
        type: "text",
      },
    ],
    structuredContent: payload,
  };
}

export class HueMcpServer {
  constructor(
    private readonly deps: CliDependencies = {},
    private readonly options: GlobalCliOptions = {},
  ) {}

  async handleMessage(message: JsonRpcRequest): Promise<JsonObject | null> {
    if (message.jsonrpc !== "2.0") {
      return errorResponse(message.id ?? null, -32600, "Invalid Request: expected jsonrpc version 2.0.");
    }
    if (typeof message.method !== "string" || message.method.length === 0) {
      return errorResponse(message.id ?? null, -32600, "Invalid Request: method is required.");
    }

    if (message.method === "notifications/initialized" || message.method === "notifications/cancelled") {
      return null;
    }

    if (message.id === undefined) {
      return null;
    }

    try {
      switch (message.method) {
        case "initialize": {
          const params = toJsonObject(message.params);
          const requestedVersion = typeof params.protocolVersion === "string" ? params.protocolVersion : undefined;
          const protocolVersion = requestedVersion && SUPPORTED_PROTOCOL_VERSIONS.includes(requestedVersion as (typeof SUPPORTED_PROTOCOL_VERSIONS)[number])
            ? requestedVersion
            : SUPPORTED_PROTOCOL_VERSIONS[0];
          return successResponse(message.id, {
            capabilities: {
              tools: {},
            },
            protocolVersion,
            serverInfo: {
              name: "openhue-client",
              version: packageVersion,
            },
          });
        }
        case "ping":
          return successResponse(message.id, {});
        case "prompts/list":
          return successResponse(message.id, { prompts: [] });
        case "resources/list":
          return successResponse(message.id, { resources: [] });
        case "tools/list":
          return successResponse(message.id, { tools: toolDefinitions });
        case "tools/call": {
          const params = toJsonObject(message.params);
          const name = typeof params.name === "string" ? params.name : undefined;
          if (!name) {
            return errorResponse(message.id, -32602, "Invalid params: tool name is required.");
          }
          const handler = toolHandlers[name];
          if (!handler) {
            return errorResponse(message.id, -32601, `Unknown tool: ${name}`);
          }
          try {
            const payload = await handler(toJsonObject(params.arguments), this.deps, this.options);
            return successResponse(message.id, formatToolResult(payload));
          } catch (error) {
            return successResponse(message.id, {
              content: [
                {
                  text: formatError(error),
                  type: "text",
                },
              ],
              isError: true,
            });
          }
        }
        default:
          return errorResponse(message.id, -32601, `Method not found: ${message.method}`);
      }
    } catch (error) {
      return errorResponse(message.id, -32603, formatError(error));
    }
  }
}

export async function runHueMcpServer(options: GlobalCliOptions = {}, deps: CliDependencies = {}, transport?: Partial<Transport>): Promise<void> {
  const server = new HueMcpServer(deps, options);
  const input = transport?.input ?? process.stdin;
  const output = transport?.output ?? process.stdout;

  const lines = createInterface({ crlfDelay: Infinity, input });
  for await (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    let message: JsonRpcRequest;
    try {
      message = JSON.parse(trimmed) as JsonRpcRequest;
    } catch (error) {
      const payload = errorResponse(null, -32700, `Parse error: ${formatError(error)}`);
      output.write(`${JSON.stringify(payload)}\n`);
      continue;
    }

    const response = await server.handleMessage(message);
    if (response) {
      output.write(`${JSON.stringify(response)}\n`);
    }
  }
}
