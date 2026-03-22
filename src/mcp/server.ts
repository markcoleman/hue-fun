import { readFileSync } from "node:fs";
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
import { createInterface } from "node:readline";

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

export interface HueMcpRunOptions extends GlobalCliOptions {
  apiKey?: string;
  apiKeyFile?: string;
  allowOrigins?: string[];
  host?: string;
  hueAppKeyHeader?: string;
  port?: number;
  transport?: string;
}

type ResolvedMcpRuntimeOptions = {
  apiKey?: string;
  allowOrigins: string[];
  host: string;
  hueAppKeyHeader: string;
  port: number;
  transport: "http" | "stdio";
};

type HttpPayloadResult =
  | { status: 202 }
  | { body: JsonObject | JsonObject[]; status: 200 };

const packageVersion = "0.1.0";
const HTTP_ENDPOINT_PATH = "/mcp";
const HTTP_ALLOW_HEADER = "GET, POST, OPTIONS";
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

function parsePort(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new HueCliError("MCP HTTP port must be an integer between 1 and 65535.", { exitCode: 2 });
  }
  return parsed;
}

function parseOriginList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function resolveApiKey(options: HueMcpRunOptions, deps: CliDependencies): string | undefined {
  if (options.apiKey) {
    return options.apiKey;
  }

  const env = deps.env ?? process.env;
  if (env.HUE_MCP_API_KEY) {
    return env.HUE_MCP_API_KEY;
  }

  const apiKeyFile = options.apiKeyFile ?? env.HUE_MCP_API_KEY_FILE;
  if (!apiKeyFile) {
    return undefined;
  }

  const cwd = deps.cwd ?? process.cwd();
  return readFileSync(resolve(cwd, apiKeyFile), "utf8").trim();
}

function resolveMcpRuntimeOptions(options: HueMcpRunOptions, deps: CliDependencies): ResolvedMcpRuntimeOptions {
  const env = deps.env ?? process.env;
  const transport = options.transport ?? env.HUE_MCP_TRANSPORT ?? "stdio";
  if (transport !== "stdio" && transport !== "http") {
    throw new HueCliError(`Unsupported MCP transport \`${transport}\`. Use stdio or http.`, { exitCode: 2 });
  }

  return {
    apiKey: resolveApiKey(options, deps),
    allowOrigins: options.allowOrigins && options.allowOrigins.length > 0
      ? options.allowOrigins
      : parseOriginList(env.HUE_MCP_ALLOWED_ORIGINS),
    host: options.host ?? env.HUE_MCP_HOST ?? "127.0.0.1",
    hueAppKeyHeader: (options.hueAppKeyHeader ?? env.HUE_MCP_HUE_APP_KEY_HEADER ?? "x-hue-application-key").toLowerCase(),
    port: options.port ?? parsePort(env.HUE_MCP_PORT, 3000),
    transport,
  };
}

function getHeader(headers: IncomingHttpHeaders, key: string): string | undefined {
  const value = headers[key.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function secureEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function isAuthorized(headers: IncomingHttpHeaders, apiKey: string | undefined): boolean {
  if (!apiKey) {
    return false;
  }

  const authorization = getHeader(headers, "authorization");
  if (authorization?.startsWith("Bearer ")) {
    return secureEquals(authorization.slice("Bearer ".length), apiKey);
  }

  const xApiKey = getHeader(headers, "x-api-key");
  if (xApiKey) {
    return secureEquals(xApiKey, apiKey);
  }

  return false;
}

function isOriginAllowed(origin: string | undefined, allowedOrigins: string[]): boolean {
  if (!origin) {
    return true;
  }
  if (allowedOrigins.includes("*")) {
    return true;
  }
  return allowedOrigins.includes(origin);
}

function applyCors(response: ServerResponse, origin: string | undefined, allowedOrigins: string[]): void {
  if (!origin || !isOriginAllowed(origin, allowedOrigins)) {
    return;
  }
  response.setHeader("Access-Control-Allow-Origin", allowedOrigins.includes("*") ? "*" : origin);
  response.setHeader("Access-Control-Allow-Headers", "authorization, content-type, hue-application-key, mcp-session-id, x-api-key, x-hue-application-key");
  response.setHeader("Access-Control-Allow-Methods", HTTP_ALLOW_HEADER);
  response.setHeader("Vary", "Origin");
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function sendEmpty(response: ServerResponse, statusCode: number): void {
  response.statusCode = statusCode;
  response.end();
}

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
              name: "newhue-client",
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

function isJsonRpcResponse(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.jsonrpc === "2.0" && ("result" in record || "error" in record) && !("method" in record);
}

function resolveRequestOptions(baseOptions: HueMcpRunOptions, requestHeaders: IncomingHttpHeaders, runtime: ResolvedMcpRuntimeOptions): GlobalCliOptions {
  const requestAppKey = getHeader(requestHeaders, "hue-application-key") ?? getHeader(requestHeaders, runtime.hueAppKeyHeader);
  return {
    ...baseOptions,
    ...(requestAppKey ? { appKey: requestAppKey } : {}),
  };
}

async function processJsonRpcPayload(
  payload: unknown,
  deps: CliDependencies,
  options: HueMcpRunOptions,
  requestHeaders: IncomingHttpHeaders,
  runtime: ResolvedMcpRuntimeOptions,
): Promise<HttpPayloadResult> {
  const items = Array.isArray(payload) ? payload : [payload];
  if (Array.isArray(payload) && items.length === 0) {
    return {
      body: [errorResponse(null, -32600, "Invalid Request: empty batch.")],
      status: 200,
    };
  }

  const scopedServer = new HueMcpServer(deps, resolveRequestOptions(options, requestHeaders, runtime));
  const responses: JsonObject[] = [];
  let sawRequest = false;

  for (const item of items) {
    if (isJsonRpcResponse(item)) {
      continue;
    }

    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      sawRequest = true;
      responses.push(errorResponse(null, -32600, "Invalid Request."));
      continue;
    }

    const message = item as JsonRpcRequest;
    if (typeof message.method === "string") {
      if (message.id !== undefined) {
        sawRequest = true;
      }
      const response = await scopedServer.handleMessage(message);
      if (response) {
        responses.push(response);
      }
      continue;
    }

    responses.push(errorResponse(message.id ?? null, -32600, "Invalid Request: method is required."));
    sawRequest = true;
  }

  if (!sawRequest || responses.length === 0) {
    return { status: 202 };
  }

  return {
    body: Array.isArray(payload) ? responses : responses[0]!,
    status: 200,
  };
}

export function createHueMcpHttpServer(options: HueMcpRunOptions = {}, deps: CliDependencies = {}): Server {
  const runtime = resolveMcpRuntimeOptions(options, deps);
  if (!runtime.apiKey) {
    throw new HueCliError("HTTP MCP transport requires HUE_MCP_API_KEY, HUE_MCP_API_KEY_FILE, --api-key, or --api-key-file.", {
      exitCode: 2,
    });
  }

  return createServer(async (request, response) => {
    const origin = getHeader(request.headers, "origin");
    applyCors(response, origin, runtime.allowOrigins);
    response.setHeader("Allow", HTTP_ALLOW_HEADER);

    if (!isOriginAllowed(origin, runtime.allowOrigins)) {
      sendJson(response, 403, { error: "Origin not allowed." });
      return;
    }

    if ((request.url ?? "").split("?")[0] !== HTTP_ENDPOINT_PATH) {
      sendJson(response, 404, { error: `Not found. Use ${HTTP_ENDPOINT_PATH}.` });
      return;
    }

    if (request.method === "OPTIONS") {
      sendEmpty(response, 204);
      return;
    }

    if (request.method === "GET") {
      sendEmpty(response, 405);
      return;
    }

    if (request.method !== "POST") {
      sendJson(response, 405, { error: "Method not allowed." });
      return;
    }

    if (!isAuthorized(request.headers, runtime.apiKey)) {
      response.setHeader("WWW-Authenticate", 'Bearer realm="hue-mcp"');
      sendJson(response, 401, { error: "Unauthorized." });
      return;
    }

    let payload: unknown;
    try {
      const body = await readRequestBody(request);
      payload = body.length === 0 ? {} : (JSON.parse(body) as unknown);
    } catch (error) {
      sendJson(response, 400, errorResponse(null, -32700, `Parse error: ${formatError(error)}`));
      return;
    }

    try {
      const result = await processJsonRpcPayload(payload, deps, options, request.headers, runtime);
      if (result.status === 202) {
        sendEmpty(response, 202);
        return;
      }
      sendJson(response, 200, result.body);
    } catch (error) {
      sendJson(response, 500, errorResponse(null, -32603, formatError(error)));
    }
  });
}

async function runHueMcpStdioServer(options: HueMcpRunOptions, deps: CliDependencies, transport?: Partial<Transport>): Promise<void> {
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

async function runHueMcpHttpServer(options: HueMcpRunOptions, deps: CliDependencies): Promise<void> {
  const runtime = resolveMcpRuntimeOptions(options, deps);
  const server = createHueMcpHttpServer(options, deps);
  const stderr = deps.stderr ?? ((line: string) => console.error(line));

  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(runtime.port, runtime.host, () => {
      server.off("error", rejectPromise);
      resolvePromise();
    });
  });

  stderr(`Hue MCP HTTP server listening on http://${runtime.host}:${runtime.port}${HTTP_ENDPOINT_PATH}`);

  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once("close", resolvePromise);
    server.once("error", rejectPromise);
  });
}

export async function runHueMcpServer(options: HueMcpRunOptions = {}, deps: CliDependencies = {}, transport?: Partial<Transport>): Promise<void> {
  const runtime = resolveMcpRuntimeOptions(options, deps);
  if (runtime.transport === "http") {
    await runHueMcpHttpServer(options, deps);
    return;
  }
  await runHueMcpStdioServer(options, deps, transport);
}
