import { createClient as createGeneratedClient, type Client as GeneratedClient } from "./generated/client";
import {
  authenticate as authenticateOperation,
  createScene,
  deleteScene,
  getEventStream,
  getGroupedLight,
  getGroupedLights,
  getLight,
  getLights,
  getScene,
  getScenes,
  updateGroupedLight,
  updateLight,
  updateScene,
} from "./generated/sdk.gen";
import * as generatedSdk from "./generated/sdk.gen";
import type {
  Error as ApiErrorEntry,
  Event as HueEvent,
  GroupedLightGet,
  GroupedLightPut,
  LightGet,
  LightPut,
  ResourceIdentifier,
  Response as AuthenticateEnvelope,
  SceneGet,
  ScenePost,
  ScenePut,
} from "./generated/types.gen";
import {
  extractHueErrorDetails,
  type GeneratedFieldsResult,
  unwrapApiData,
  unwrapResult,
  unwrapSingleResource,
} from "./internal/api";
import {
  HueApiError,
  HueAuthError,
  HueHttpError,
  HueLinkButtonNotPressedError,
  type HueErrorDetail,
} from "./internal/errors";
import { SseParser } from "./internal/sse";

const DEFAULT_DISCOVERY_URL = "https://discovery.meethue.com/";
const DEFAULT_RECONNECT_DELAY_MS = 250;

type OperationWithClient = (options?: Record<string, unknown>) => unknown;

export type BoundRawSdk = {
  [K in keyof typeof generatedSdk]: typeof generatedSdk[K] extends (
    options?: infer TOptions,
  ) => infer TResult
    ? (options?: Omit<TOptions, "client">) => TResult
    : typeof generatedSdk[K] extends (options: infer TOptions) => infer TResult
      ? (options: Omit<TOptions, "client">) => TResult
      : never;
};

export interface XYColor {
  x: number;
  y: number;
}

export interface HueLightStateInput {
  brightness?: number;
  colorTemperatureMirek?: number;
  effect?: LightPut["effects"] extends infer T ? T extends { effect?: infer U } ? U : never : never;
  on?: boolean;
  transitionMs?: number;
  xy?: XYColor;
}

export interface HueGroupedLightStateInput {
  brightness?: number;
  colorTemperatureMirek?: number;
  on?: boolean;
  transitionMs?: number;
  xy?: XYColor;
}

interface TransportOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  userAgent?: string;
}

export interface HueClientOptions extends TransportOptions {
  applicationKey: string;
  bridgeUrl: string;
  clientKey?: string;
  headers?: HeadersInit;
}

export interface DiscoverHueBridgesOptions extends TransportOptions {
  signal?: AbortSignal;
}

export interface AuthenticateOptions extends TransportOptions {
  bridgeUrl: string;
  deviceType: string;
  generateClientKey?: boolean;
  headers?: HeadersInit;
  signal?: AbortSignal;
}

export interface AuthenticateResult {
  applicationKey: string;
  clientKey?: string;
}

export interface RawDiscoveredBridge {
  id: string;
  internalipaddress: string;
  port?: number;
}

export interface DiscoveredBridge {
  baseUrl: string;
  id: string;
  internalIpAddress: string;
  port?: number;
  raw: RawDiscoveredBridge;
}

export interface HueEventPollOptions {
  since?: string;
}

export interface HueEventStreamOptions {
  reconnect?: boolean;
  reconnectDelayMs?: number;
  signal?: AbortSignal;
  since?: string;
}

export interface HueEventMessage {
  events: HueEvent[];
  id?: string;
}

export interface HueClient {
  readonly applicationKey: string;
  readonly bridgeUrl: string;
  readonly clientKey?: string;
  readonly options: Readonly<HueClientOptions>;
  readonly raw: BoundRawSdk;
  readonly events: {
    poll(options?: HueEventPollOptions): Promise<HueEvent[]>;
    stream(options?: HueEventStreamOptions): AsyncIterable<HueEventMessage>;
  };
  readonly groupedLights: {
    applyState(groupedLightId: string, state: HueGroupedLightStateInput): Promise<ResourceIdentifier[]>;
    get(groupedLightId: string): Promise<GroupedLightGet>;
    list(): Promise<GroupedLightGet[]>;
    off(groupedLightId: string): Promise<ResourceIdentifier[]>;
    on(groupedLightId: string): Promise<ResourceIdentifier[]>;
    setBrightness(groupedLightId: string, brightness: number): Promise<ResourceIdentifier[]>;
    setColorTemperature(groupedLightId: string, mirek: number): Promise<ResourceIdentifier[]>;
    setColorXY(groupedLightId: string, xy: XYColor): Promise<ResourceIdentifier[]>;
  };
  readonly lights: {
    applyState(lightId: string, state: HueLightStateInput): Promise<ResourceIdentifier[]>;
    get(lightId: string): Promise<LightGet>;
    list(): Promise<LightGet[]>;
    off(lightId: string): Promise<ResourceIdentifier[]>;
    on(lightId: string): Promise<ResourceIdentifier[]>;
    setBrightness(lightId: string, brightness: number): Promise<ResourceIdentifier[]>;
    setColorTemperature(lightId: string, mirek: number): Promise<ResourceIdentifier[]>;
    setColorXY(lightId: string, xy: XYColor): Promise<ResourceIdentifier[]>;
  };
  readonly scenes: {
    create(body: ScenePost): Promise<ResourceIdentifier[]>;
    delete(sceneId: string): Promise<ResourceIdentifier[]>;
    get(sceneId: string): Promise<SceneGet>;
    list(): Promise<SceneGet[]>;
    recall(sceneId: string, recall?: NonNullable<ScenePut["recall"]>): Promise<ResourceIdentifier[]>;
    update(sceneId: string, body: ScenePut): Promise<ResourceIdentifier[]>;
  };
}

function normalizeBridgeUrl(bridgeUrl: string): string {
  return bridgeUrl.replace(/\/+$/, "");
}

function isNodeRuntime(): boolean {
  return typeof window === "undefined";
}

function mergeAbortSignals(signal: AbortSignal | null | undefined, timeoutMs?: number): AbortSignal | undefined {
  if (signal === undefined && timeoutMs === undefined) {
    return undefined;
  }

  const controller = new AbortController();

  if (signal?.aborted) {
    controller.abort(signal.reason);
    return controller.signal;
  }

  const abortFromParent = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abortFromParent, { once: true });

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  if (timeoutMs !== undefined) {
    timeoutId = setTimeout(() => {
      controller.abort(new DOMException(`Hue request timed out after ${timeoutMs}ms`, "AbortError"));
    }, timeoutMs);

    controller.signal.addEventListener(
      "abort",
      () => {
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }
      },
      { once: true },
    );
  }

  controller.signal.addEventListener(
    "abort",
    () => {
      signal?.removeEventListener("abort", abortFromParent);
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    },
    { once: true },
  );

  return controller.signal;
}

function createConfiguredFetch(options: TransportOptions): typeof fetch {
  const implementation = options.fetch ?? globalThis.fetch;
  if (!implementation) {
    throw new Error("No Fetch API implementation is available.");
  }

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    if (!headers.has("Accept")) {
      headers.set("Accept", "application/json");
    }
    if (options.userAgent && isNodeRuntime() && !headers.has("User-Agent")) {
      headers.set("User-Agent", options.userAgent);
    }

    return implementation(input, {
      ...init,
      headers,
      signal: mergeAbortSignals(init?.signal, options.timeoutMs),
    });
  };
}

function bindRawSdk(client: GeneratedClient): BoundRawSdk {
  const bound: Record<string, OperationWithClient> = {};

  for (const [key, value] of Object.entries(generatedSdk)) {
    if (typeof value !== "function") {
      continue;
    }

    bound[key] = (options?: Record<string, unknown>) => {
      const resolvedOptions = options === undefined ? { client } : { ...options, client };
      return (value as OperationWithClient)(resolvedOptions);
    };
  }

  return bound as unknown as BoundRawSdk;
}

function serializeLightState(state: HueLightStateInput): LightPut {
  const body: LightPut = {};

  if (state.on !== undefined) {
    body.on = { on: state.on };
  }
  if (state.brightness !== undefined) {
    body.dimming = { brightness: state.brightness };
  }
  if (state.colorTemperatureMirek !== undefined) {
    body.color_temperature = { mirek: state.colorTemperatureMirek };
  }
  if (state.xy !== undefined) {
    body.color = { xy: state.xy };
  }
  if (state.transitionMs !== undefined || state.effect !== undefined) {
    body.dynamics = state.transitionMs !== undefined ? { duration: state.transitionMs } : undefined;
  }
  if (state.effect !== undefined) {
    body.effects = { effect: state.effect };
  }

  return body;
}

function serializeGroupedLightState(state: HueGroupedLightStateInput): GroupedLightPut {
  const body: GroupedLightPut = {};

  if (state.on !== undefined) {
    body.on = { on: state.on };
  }
  if (state.brightness !== undefined) {
    body.dimming = { brightness: state.brightness };
  }
  if (state.colorTemperatureMirek !== undefined) {
    body.color_temperature = { mirek: state.colorTemperatureMirek };
  }
  if (state.xy !== undefined) {
    body.color = { xy: state.xy };
  }
  if (state.transitionMs !== undefined) {
    body.dynamics = { duration: state.transitionMs };
  }

  return body;
}

function parseAuthenticationResponse(payload: AuthenticateEnvelope): AuthenticateResult {
  const [firstEntry] = payload;
  if (firstEntry === undefined) {
    throw new HueAuthError("Hue authentication returned an unexpected response", [], payload);
  }

  if (firstEntry?.success?.username) {
    return {
      applicationKey: firstEntry.success.username,
      clientKey: firstEntry.success.clientkey,
    };
  }

  const details = extractHueErrorDetails(payload);
  if (details.some((detail) => detail.type === HueLinkButtonNotPressedError.linkButtonErrorType)) {
    throw new HueLinkButtonNotPressedError(details, payload);
  }

  throw new HueAuthError("Hue authentication failed", details, payload);
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener("abort", abortListener);
      resolve();
    }, ms);

    const abortListener = () => {
      clearTimeout(timeoutId);
      reject(signal?.reason ?? new DOMException("The operation was aborted.", "AbortError"));
    };

    signal?.addEventListener("abort", abortListener, { once: true });
  });
}

function parseEventMessage(message: { data?: string; id?: string }): HueEventMessage {
  if (!message.data) {
    return { events: [], id: message.id };
  }

  const parsed = JSON.parse(message.data) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Hue event stream returned a non-array event payload.");
  }

  return {
    events: parsed as HueEvent[],
    id: message.id,
  };
}

function createClientRuntime(options: HueClientOptions): {
  fetch: typeof fetch;
  generatedClient: GeneratedClient;
} {
  const fetch = createConfiguredFetch(options);
  const generatedClient = createGeneratedClient({
    auth: () => options.applicationKey,
    baseUrl: normalizeBridgeUrl(options.bridgeUrl),
    fetch,
    headers: options.headers,
    responseStyle: "fields",
    throwOnError: false,
  });

  return { fetch, generatedClient };
}

/**
 * Discover Hue bridges on the local network via the official Meethue discovery service.
 */
export async function discoverHueBridges(
  options: DiscoverHueBridgesOptions = {},
): Promise<DiscoveredBridge[]> {
  const fetch = createConfiguredFetch(options);
  const response = await fetch(DEFAULT_DISCOVERY_URL, {
    method: "GET",
    signal: options.signal,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new HueHttpError({
      body,
      status: response.status,
      statusText: response.statusText,
      url: DEFAULT_DISCOVERY_URL,
    });
  }

  const payload = (await response.json()) as RawDiscoveredBridge[];
  return payload.map((bridge) => ({
    baseUrl: `https://${bridge.port ? `${bridge.internalipaddress}:${bridge.port}` : bridge.internalipaddress}`,
    id: bridge.id,
    internalIpAddress: bridge.internalipaddress,
    port: bridge.port,
    raw: bridge,
  }));
}

/**
 * Authenticate against a Hue bridge to retrieve an application key.
 */
export async function authenticate(options: AuthenticateOptions): Promise<AuthenticateResult> {
  const generatedClient = createGeneratedClient({
    baseUrl: normalizeBridgeUrl(options.bridgeUrl),
    fetch: createConfiguredFetch(options),
    headers: options.headers,
    responseStyle: "fields",
    throwOnError: false,
  });

  const result = (await authenticateOperation({
    body: {
      devicetype: options.deviceType,
      ...(options.generateClientKey ? { generateclientkey: true } : {}),
    },
    client: generatedClient,
    signal: options.signal,
  })) as GeneratedFieldsResult<AuthenticateEnvelope>;

  return parseAuthenticationResponse(unwrapResult(result, "authenticate"));
}

/**
 * Create a high-level Hue client with typed helpers plus the generated low-level SDK.
 */
export function createHueClient(options: HueClientOptions): HueClient {
  const normalizedOptions: HueClientOptions = {
    ...options,
    bridgeUrl: normalizeBridgeUrl(options.bridgeUrl),
  };
  const { fetch, generatedClient } = createClientRuntime(normalizedOptions);
  const raw = bindRawSdk(generatedClient);

  const applyLightState = async (lightId: string, state: HueLightStateInput) =>
    unwrapApiData<ResourceIdentifier>(
      (await updateLight({
        body: serializeLightState(state),
        client: generatedClient,
        path: { lightId },
      })) as GeneratedFieldsResult<{ data?: ResourceIdentifier[]; errors?: ApiErrorEntry[] }>,
      "updateLight",
    );

  const applyGroupedLightState = async (groupedLightId: string, state: HueGroupedLightStateInput) =>
    unwrapApiData<ResourceIdentifier>(
      (await updateGroupedLight({
        body: serializeGroupedLightState(state),
        client: generatedClient,
        path: { groupedLightId },
      })) as GeneratedFieldsResult<{ data?: ResourceIdentifier[]; errors?: ApiErrorEntry[] }>,
      "updateGroupedLight",
    );

  return {
    applicationKey: normalizedOptions.applicationKey,
    bridgeUrl: normalizedOptions.bridgeUrl,
    clientKey: normalizedOptions.clientKey,
    options: Object.freeze({ ...normalizedOptions }),
    raw,
    events: {
      async poll(eventOptions = {}) {
        const result = (await getEventStream({
          client: generatedClient,
          headers: eventOptions.since ? { "If-None-Match": eventOptions.since } : undefined,
          parseAs: "json",
        })) as GeneratedFieldsResult<HueEvent[]>;
        return unwrapResult(result, "getEventStream");
      },
      async *stream(eventOptions = {}) {
        let lastEventId = eventOptions.since;
        const reconnect = eventOptions.reconnect ?? true;
        const reconnectDelayMs = eventOptions.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;

        while (!eventOptions.signal?.aborted) {
          const headers = new Headers(normalizedOptions.headers);
          headers.set("Accept", "text/event-stream");
          headers.set("hue-application-key", normalizedOptions.applicationKey);
          if (normalizedOptions.userAgent && isNodeRuntime() && !headers.has("User-Agent")) {
            headers.set("User-Agent", normalizedOptions.userAgent);
          }
          if (lastEventId) {
            headers.set("If-None-Match", lastEventId);
          }

          const response = await fetch(`${normalizedOptions.bridgeUrl}/eventstream/clip/v2`, {
            headers,
            method: "GET",
            signal: eventOptions.signal,
          });

          if (!response.ok) {
            const body = await response.text();
            throw new HueHttpError({
              body,
              status: response.status,
              statusText: response.statusText,
              url: response.url,
            });
          }

          if (!response.body) {
            throw new Error("Hue event stream did not provide a readable response body.");
          }

          const parser = new SseParser();
          const decoder = new TextDecoder();
          const reader = response.body.getReader();

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                break;
              }

              const chunk = decoder.decode(value, { stream: true });
              for (const message of parser.push(chunk)) {
                const parsed = parseEventMessage(message);
                if (parsed.id) {
                  lastEventId = parsed.id;
                }
                yield parsed;
              }
            }

            const trailingChunk = decoder.decode();
            if (trailingChunk.length > 0) {
              for (const message of parser.push(trailingChunk)) {
                const parsed = parseEventMessage(message);
                if (parsed.id) {
                  lastEventId = parsed.id;
                }
                yield parsed;
              }
            }

            for (const message of parser.finish()) {
              const parsed = parseEventMessage(message);
              if (parsed.id) {
                lastEventId = parsed.id;
              }
              yield parsed;
            }
          } finally {
            reader.releaseLock();
          }

          if (!reconnect) {
            return;
          }

          await sleep(reconnectDelayMs, eventOptions.signal);
        }
      },
    },
    groupedLights: {
      applyState: applyGroupedLightState,
      async get(groupedLightId) {
        const items = unwrapApiData<GroupedLightGet>(
          (await getGroupedLight({ client: generatedClient, path: { groupedLightId } })) as GeneratedFieldsResult<{
            data?: GroupedLightGet[];
            errors?: ApiErrorEntry[];
          }>,
          "getGroupedLight",
        );
        return unwrapSingleResource(items, groupedLightId, "getGroupedLight");
      },
      async list() {
        return unwrapApiData<GroupedLightGet>(
          (await getGroupedLights({ client: generatedClient })) as GeneratedFieldsResult<{
            data?: GroupedLightGet[];
            errors?: ApiErrorEntry[];
          }>,
          "getGroupedLights",
        );
      },
      off(groupedLightId) {
        return applyGroupedLightState(groupedLightId, { on: false });
      },
      on(groupedLightId) {
        return applyGroupedLightState(groupedLightId, { on: true });
      },
      setBrightness(groupedLightId, brightness) {
        return applyGroupedLightState(groupedLightId, { brightness });
      },
      setColorTemperature(groupedLightId, mirek) {
        return applyGroupedLightState(groupedLightId, { colorTemperatureMirek: mirek });
      },
      setColorXY(groupedLightId, xy) {
        return applyGroupedLightState(groupedLightId, { xy });
      },
    },
    lights: {
      applyState: applyLightState,
      async get(lightId) {
        const items = unwrapApiData<LightGet>(
          (await getLight({ client: generatedClient, path: { lightId } })) as GeneratedFieldsResult<{
            data?: LightGet[];
            errors?: ApiErrorEntry[];
          }>,
          "getLight",
        );
        return unwrapSingleResource(items, lightId, "getLight");
      },
      async list() {
        return unwrapApiData<LightGet>(
          (await getLights({ client: generatedClient })) as GeneratedFieldsResult<{
            data?: LightGet[];
            errors?: ApiErrorEntry[];
          }>,
          "getLights",
        );
      },
      off(lightId) {
        return applyLightState(lightId, { on: false });
      },
      on(lightId) {
        return applyLightState(lightId, { on: true });
      },
      setBrightness(lightId, brightness) {
        return applyLightState(lightId, { brightness });
      },
      setColorTemperature(lightId, mirek) {
        return applyLightState(lightId, { colorTemperatureMirek: mirek });
      },
      setColorXY(lightId, xy) {
        return applyLightState(lightId, { xy });
      },
    },
    scenes: {
      async create(body) {
        return unwrapApiData<ResourceIdentifier>(
          (await createScene({ body, client: generatedClient })) as GeneratedFieldsResult<{
            data?: ResourceIdentifier[];
            errors?: ApiErrorEntry[];
          }>,
          "createScene",
        );
      },
      async delete(sceneId) {
        return unwrapApiData<ResourceIdentifier>(
          (await deleteScene({ client: generatedClient, path: { sceneId } })) as GeneratedFieldsResult<{
            data?: ResourceIdentifier[];
            errors?: ApiErrorEntry[];
          }>,
          "deleteScene",
        );
      },
      async get(sceneId) {
        const items = unwrapApiData<SceneGet>(
          (await getScene({ client: generatedClient, path: { sceneId } })) as GeneratedFieldsResult<{
            data?: SceneGet[];
            errors?: ApiErrorEntry[];
          }>,
          "getScene",
        );
        return unwrapSingleResource(items, sceneId, "getScene");
      },
      async list() {
        return unwrapApiData<SceneGet>(
          (await getScenes({ client: generatedClient })) as GeneratedFieldsResult<{
            data?: SceneGet[];
            errors?: ApiErrorEntry[];
          }>,
          "getScenes",
        );
      },
      async recall(sceneId, recall = { action: "active" }) {
        return unwrapApiData<ResourceIdentifier>(
          (await updateScene({
            body: { recall },
            client: generatedClient,
            path: { sceneId },
          })) as GeneratedFieldsResult<{ data?: ResourceIdentifier[]; errors?: ApiErrorEntry[] }>,
          "updateScene",
        );
      },
      async update(sceneId, body) {
        return unwrapApiData<ResourceIdentifier>(
          (await updateScene({
            body,
            client: generatedClient,
            path: { sceneId },
          })) as GeneratedFieldsResult<{ data?: ResourceIdentifier[]; errors?: ApiErrorEntry[] }>,
          "updateScene",
        );
      },
    },
  };
}

export {
  HueApiError,
  HueAuthError,
  HueHttpError,
  HueLinkButtonNotPressedError,
};
export type { HueErrorDetail };
