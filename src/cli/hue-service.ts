import { createHueClient, type HueClient, type HueGroupedLightStateInput, type HueLightStateInput } from "../index";
import type {
  DeviceGet,
  Error as ApiErrorEntry,
  GroupedLightGet,
  ResourceIdentifier,
  RoomArchetype,
  RoomGet,
  RoomPut,
  SceneGet,
  ScenePut,
} from "../generated/types.gen";
import type { LightGet } from "../generated";
import { type GeneratedFieldsResult, unwrapApiData, unwrapSingleResource } from "../internal/api";
import { createDebugFetch, enableInsecureTls } from "../internal/bridge-runtime";
import type {
  CliDependencies,
  GroupCreateOptions,
  GroupStateOptions,
  PromptAdapter,
  ResolvedCliSettings,
} from "./types";
import { HueCliError as HueCliErrorClass } from "./types";

type GroupKind = "room" | "zone";
type ResourceKind = "light" | GroupKind | "scene";

export interface InventoryLight {
  brightness?: number;
  deviceId: string;
  id: string;
  location: string;
  name: string;
  on: boolean;
  raw: LightGet;
  roomName?: string;
  zones: string[];
}

export interface InventoryGroup {
  archetype: RoomArchetype;
  deviceIds: string[];
  groupedLightId?: string;
  id: string;
  kind: GroupKind;
  lightIds: string[];
  name: string;
  on?: boolean;
  raw: RoomGet;
}

export interface InventoryScene {
  groupId: string;
  id: string;
  name: string;
  raw: SceneGet;
}

export interface HueInventory {
  devices: DeviceGet[];
  groupedLights: GroupedLightGet[];
  lights: InventoryLight[];
  rawLights: LightGet[];
  roomMap: Map<string, InventoryGroup>;
  rooms: InventoryGroup[];
  sceneMap: Map<string, InventoryScene>;
  scenes: InventoryScene[];
  zoneMap: Map<string, InventoryGroup>;
  zones: InventoryGroup[];
}

function resourceOperationName(kind: GroupKind, action: string): string {
  const title = kind === "room" ? "Room" : "Zone";
  return `${action}${title}`;
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
    for (const child of resource.children) {
      map.set(child.rid, resource.metadata.name);
    }
    for (const service of resource.services) {
      map.set(service.rid, resource.metadata.name);
    }
  }
  return map;
}

function buildZoneMap(resources: RoomGet[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const resource of resources) {
    const refs: ResourceIdentifier[] = [...resource.children, ...resource.services];
    for (const ref of refs) {
      const current = map.get(ref.rid) ?? [];
      if (!current.includes(resource.metadata.name)) {
        current.push(resource.metadata.name);
      }
      map.set(ref.rid, current);
    }
  }
  return map;
}

function getDeviceName(device: DeviceGet | undefined, light: LightGet): string {
  return device?.metadata.name ?? light.metadata.name ?? light.id;
}

function createDebugLogger(deps: CliDependencies) {
  return (line: string) => (deps.stderr ?? ((value: string) => console.error(value)))(line);
}

export function createCliHueClient(settings: ResolvedCliSettings, deps: CliDependencies): HueClient {
  if (!settings.bridgeUrl || !settings.applicationKey) {
    throw new HueCliErrorClass("Bridge URL and application key are required for this command.", { exitCode: 2 });
  }

  if (settings.allowInsecureTls) {
    enableInsecureTls({ secureTls: false }, { HUE_INSECURE_TLS: "1" });
  }

  const debugFetch = createDebugFetch(
    { debugHttp: settings.debugHttp },
    settings.env,
    deps.fetch ?? globalThis.fetch,
    createDebugLogger(deps),
  );

  return createHueClient({
    applicationKey: settings.applicationKey,
    bridgeUrl: settings.bridgeUrl,
    ...(settings.clientKey ? { clientKey: settings.clientKey } : {}),
    ...(debugFetch ? { fetch: debugFetch } : deps.fetch ? { fetch: deps.fetch } : {}),
    userAgent: "openhue-client-cli/0.1.0",
  });
}

export async function listGroups(client: HueClient, kind: GroupKind): Promise<RoomGet[]> {
  const result =
    kind === "room"
      ? ((await client.raw.getRooms()) as GeneratedFieldsResult<{ data?: RoomGet[] }>)
      : ((await client.raw.getZones()) as GeneratedFieldsResult<{ data?: RoomGet[] }>);
  return unwrapApiData<RoomGet>(
    result as GeneratedFieldsResult<{ data?: RoomGet[]; errors?: ApiErrorEntry[] }>,
    resourceOperationName(kind, "get"),
  );
}

async function getGroupById(client: HueClient, kind: GroupKind, id: string): Promise<RoomGet> {
  const result =
    kind === "room"
      ? ((await client.raw.getRoom({ path: { roomId: id } })) as GeneratedFieldsResult<{ data?: RoomGet[] }>)
      : ((await client.raw.getZone({ path: { zoneId: id } })) as GeneratedFieldsResult<{ data?: RoomGet[] }>);
  const items = unwrapApiData<RoomGet>(
    result as GeneratedFieldsResult<{ data?: RoomGet[]; errors?: ApiErrorEntry[] }>,
    resourceOperationName(kind, "get"),
  );
  return unwrapSingleResource(items, id, resourceOperationName(kind, "get"));
}

export async function createGroup(client: HueClient, kind: GroupKind, options: GroupCreateOptions): Promise<ResourceIdentifier[]> {
  const body: RoomPut = {
    children: options.members,
    metadata: {
      archetype: options.archetype ?? "other",
      name: options.name,
    },
  };

  const result =
    kind === "room"
      ? ((await client.raw.createRoom({ body })) as GeneratedFieldsResult<{ data?: ResourceIdentifier[] }>)
      : ((await client.raw.createZone({ body })) as GeneratedFieldsResult<{ data?: ResourceIdentifier[] }>);
  return unwrapApiData<ResourceIdentifier>(
    result as GeneratedFieldsResult<{ data?: ResourceIdentifier[]; errors?: ApiErrorEntry[] }>,
    resourceOperationName(kind, "create"),
  );
}

export async function updateGroup(client: HueClient, kind: GroupKind, id: string, body: RoomPut): Promise<ResourceIdentifier[]> {
  const result =
    kind === "room"
      ? ((await client.raw.updateRoom({ body, path: { roomId: id } })) as GeneratedFieldsResult<{
          data?: ResourceIdentifier[];
        }>)
      : ((await client.raw.updateZone({ body, path: { zoneId: id } })) as GeneratedFieldsResult<{
          data?: ResourceIdentifier[];
        }>);
  return unwrapApiData<ResourceIdentifier>(
    result as GeneratedFieldsResult<{ data?: ResourceIdentifier[]; errors?: ApiErrorEntry[] }>,
    resourceOperationName(kind, "update"),
  );
}

export async function deleteGroup(client: HueClient, kind: GroupKind, id: string): Promise<ResourceIdentifier[]> {
  const result =
    kind === "room"
      ? ((await client.raw.deleteRoom({ path: { roomId: id } })) as GeneratedFieldsResult<{ data?: ResourceIdentifier[] }>)
      : ((await client.raw.deleteZone({ path: { zoneId: id } })) as GeneratedFieldsResult<{ data?: ResourceIdentifier[] }>);
  return unwrapApiData<ResourceIdentifier>(
    result as GeneratedFieldsResult<{ data?: ResourceIdentifier[]; errors?: ApiErrorEntry[] }>,
    resourceOperationName(kind, "delete"),
  );
}

export async function loadInventory(client: HueClient): Promise<HueInventory> {
  const [rawLights, groupedLights, scenes, devicesResult, roomsResult, zonesResult] = await Promise.all([
    client.lights.list(),
    client.groupedLights.list(),
    client.scenes.list(),
    client.raw.getDevices() as Promise<GeneratedFieldsResult<{ data?: DeviceGet[] }>>,
    client.raw.getRooms() as Promise<GeneratedFieldsResult<{ data?: RoomGet[] }>>,
    client.raw.getZones() as Promise<GeneratedFieldsResult<{ data?: RoomGet[] }>>,
  ]);

  const devices = unwrapApiData<DeviceGet>(
    devicesResult as GeneratedFieldsResult<{ data?: DeviceGet[]; errors?: ApiErrorEntry[] }>,
    "getDevices",
  );
  const rooms = unwrapApiData<RoomGet>(
    roomsResult as GeneratedFieldsResult<{ data?: RoomGet[]; errors?: ApiErrorEntry[] }>,
    "getRooms",
  );
  const zones = unwrapApiData<RoomGet>(
    zonesResult as GeneratedFieldsResult<{ data?: RoomGet[]; errors?: ApiErrorEntry[] }>,
    "getZones",
  );

  const groupedLightMap = new Map(groupedLights.map((groupedLight) => [groupedLight.id, groupedLight]));
  const deviceMap = new Map(devices.map((device) => [device.id, device]));
  const roomByRid = buildLocationMap(rooms);
  const zoneByRid = buildZoneMap(zones);

  const lights = rawLights
    .map((light) => {
      const deviceId = light.owner.rid;
      const roomName = roomByRid.get(deviceId) ?? roomByRid.get(light.id);
      const zonesForLight = [
        ...(zoneByRid.get(deviceId) ?? []),
        ...(zoneByRid.get(light.id) ?? []),
      ].filter((value, index, values) => values.indexOf(value) === index);

      return {
        brightness: light.dimming?.brightness,
        deviceId,
        id: light.id,
        location: locationLabel(roomName, zonesForLight),
        name: getDeviceName(deviceMap.get(deviceId), light),
        on: light.on.on,
        raw: light,
        roomName,
        zones: zonesForLight,
      } satisfies InventoryLight;
    })
    .sort((left, right) => left.name.localeCompare(right.name));

  const lightIdsByDeviceId = new Map<string, string[]>();
  for (const light of lights) {
    const current = lightIdsByDeviceId.get(light.deviceId) ?? [];
    current.push(light.id);
    lightIdsByDeviceId.set(light.deviceId, current);
  }

  const mapGroup = (raw: RoomGet, kind: GroupKind): InventoryGroup => {
    const groupedLightId = raw.services.find((service) => service.rtype === "grouped_light")?.rid;
    const deviceIds = raw.children.filter((child) => child.rtype === "device").map((child) => child.rid);
    const lightIds = deviceIds.flatMap((deviceId) => lightIdsByDeviceId.get(deviceId) ?? []);

    return {
      archetype: raw.metadata.archetype,
      deviceIds,
      groupedLightId,
      id: raw.id,
      kind,
      lightIds,
      name: raw.metadata.name,
      on: groupedLightId ? groupedLightMap.get(groupedLightId)?.on?.on : undefined,
      raw,
    };
  };

  const roomViews = rooms.map((room) => mapGroup(room, "room")).sort((left, right) => left.name.localeCompare(right.name));
  const zoneViews = zones.map((zone) => mapGroup(zone, "zone")).sort((left, right) => left.name.localeCompare(right.name));
  const sceneViews = scenes
    .map((scene) => ({ groupId: scene.group.rid, id: scene.id, name: scene.metadata.name ?? scene.id, raw: scene }))
    .sort((left, right) => left.name.localeCompare(right.name));

  return {
    devices,
    groupedLights,
    lights,
    rawLights,
    roomMap: new Map(roomViews.map((room) => [room.id, room])),
    rooms: roomViews,
    sceneMap: new Map(sceneViews.map((scene) => [scene.id, scene])),
    scenes: sceneViews,
    zoneMap: new Map(zoneViews.map((zone) => [zone.id, zone])),
    zones: zoneViews,
  };
}

function describeTarget(input: string | undefined, kind: ResourceKind): string {
  return input ? `${kind} \`${input}\`` : kind;
}

function exactNameMatch<T extends { id: string; name: string }>(items: T[], input: string): T[] {
  const lower = input.toLowerCase();
  return items.filter((item) => item.name.toLowerCase() === lower || item.id === input);
}

async function resolveFromItems<T extends { id: string; name: string }>(options: {
  input?: string;
  items: T[];
  kind: ResourceKind;
  prompt?: PromptAdapter;
}): Promise<T> {
  if (options.input) {
    const exactId = options.items.find((item) => item.id === options.input);
    if (exactId) {
      return exactId;
    }

    const matches = exactNameMatch(options.items, options.input);
    if (matches.length === 1) {
      return matches[0]!;
    }

    if (matches.length > 1 && options.prompt) {
      const selected = await options.prompt.select(
        `Select ${describeTarget(options.input, options.kind)}`,
        matches.map((item) => ({ description: item.id, title: item.name, value: item.id })),
      );
      if (!selected) {
        throw new HueCliErrorClass(`No ${options.kind} selected.`, { exitCode: 2 });
      }
      return matches.find((item) => item.id === selected)!;
    }

    if (matches.length > 1) {
      throw new HueCliErrorClass(
        `Ambiguous ${options.kind} \`${options.input}\`: ${matches.map((item) => `${item.name} (${item.id})`).join(", ")}`,
        { exitCode: 2 },
      );
    }

    throw new HueCliErrorClass(`Unknown ${options.kind} \`${options.input}\`.`, { exitCode: 2 });
  }

  if (!options.prompt) {
    throw new HueCliErrorClass(`Missing ${options.kind} target.`, { exitCode: 2 });
  }

  const selected = await options.prompt.select(
    `Select ${options.kind}`,
    options.items.map((item) => ({ description: item.id, title: item.name, value: item.id })),
  );
  if (!selected) {
    throw new HueCliErrorClass(`No ${options.kind} selected.`, { exitCode: 2 });
  }
  return options.items.find((item) => item.id === selected)!;
}

export async function resolveLight(inventory: HueInventory, input: string | undefined, prompt?: PromptAdapter) {
  return resolveFromItems({ input, items: inventory.lights, kind: "light", prompt });
}

export async function resolveGroup(
  inventory: HueInventory,
  kind: GroupKind,
  input: string | undefined,
  prompt?: PromptAdapter,
) {
  return resolveFromItems({ input, items: kind === "room" ? inventory.rooms : inventory.zones, kind, prompt });
}

export async function resolveScene(inventory: HueInventory, input: string | undefined, prompt?: PromptAdapter) {
  return resolveFromItems({ input, items: inventory.scenes, kind: "scene", prompt });
}

function resolveDeviceByInput(inventory: HueInventory, input: string): DeviceGet | undefined {
  const exactId = inventory.devices.find((device) => device.id === input);
  if (exactId) {
    return exactId;
  }

  const lower = input.toLowerCase();
  return inventory.devices.find((device) => device.metadata.name.toLowerCase() === lower);
}

export async function resolveMemberDeviceRefs(
  inventory: HueInventory,
  inputs: string[],
  prompt?: PromptAdapter,
): Promise<ResourceIdentifier[]> {
  if (inputs.length === 0) {
    if (!prompt) {
      return [];
    }

    const selected = await prompt.multiselect(
      "Select lights or devices",
      [
        ...inventory.lights.map((light) => ({ description: light.id, title: `${light.name} [light]`, value: `light:${light.id}` })),
        ...inventory.devices.map((device) => ({ description: device.id, title: `${device.metadata.name} [device]`, value: `device:${device.id}` })),
      ],
    );
    inputs = selected.map((entry) => entry.replace(/^(light|device):/, ""));
  }

  const refs = new Map<string, ResourceIdentifier>();
  for (const input of inputs) {
    const light = inventory.lights.find((entry) => entry.id === input || entry.name.toLowerCase() === input.toLowerCase());
    if (light) {
      refs.set(light.deviceId, { rid: light.deviceId, rtype: "device" });
      continue;
    }

    const device = resolveDeviceByInput(inventory, input);
    if (device) {
      refs.set(device.id, { rid: device.id, rtype: "device" });
      continue;
    }

    throw new HueCliErrorClass(`Unknown member \`${input}\`.`, { exitCode: 2 });
  }

  return Array.from(refs.values());
}

export async function applyLightState(client: HueClient, lightId: string, state: HueLightStateInput) {
  return client.lights.applyState(lightId, state);
}

export async function applyGroupState(client: HueClient, group: InventoryGroup, state: GroupStateOptions) {
  if (!group.groupedLightId) {
    throw new HueCliErrorClass(`${group.kind} \`${group.name}\` does not expose a grouped light service.`, { exitCode: 2 });
  }

  const payload: HueGroupedLightStateInput = {
    brightness: state.brightness,
    colorTemperatureMirek: state.colorTemperatureMirek,
    on: state.on,
    transitionMs: state.transitionMs,
    xy: state.xy,
  };

  return client.groupedLights.applyState(group.groupedLightId, payload);
}

export async function toggleLight(client: HueClient, light: InventoryLight) {
  return client.lights.applyState(light.id, { on: !light.on });
}

export async function recallScene(client: HueClient, scene: InventoryScene, recall?: ScenePut["recall"]) {
  return client.scenes.recall(scene.id, recall);
}

export async function refreshGroup(client: HueClient, kind: GroupKind, id: string): Promise<InventoryGroup> {
  const raw = await getGroupById(client, kind, id);
  const inventory = await loadInventory(client);
  const group = kind === "room" ? inventory.roomMap.get(raw.id) : inventory.zoneMap.get(raw.id);
  if (!group) {
    throw new HueCliErrorClass(`Unable to load updated ${kind} \`${id}\`.`, { exitCode: 1 });
  }
  return group;
}

export function mergeGroupMembers(
  current: InventoryGroup,
  nextMembers: ResourceIdentifier[],
  mode: "add" | "assign" | "remove",
): ResourceIdentifier[] {
  const map = new Map(current.raw.children.map((child) => [child.rid, child]));
  if (mode === "assign") {
    return nextMembers;
  }

  if (mode === "add") {
    for (const member of nextMembers) {
      map.set(member.rid, member);
    }
    return Array.from(map.values());
  }

  for (const member of nextMembers) {
    map.delete(member.rid);
  }
  return Array.from(map.values());
}
