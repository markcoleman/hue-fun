import { Command, CommanderError } from "commander";

import { authenticate, discoverHueBridges } from "../index";
import { runHueMcpServer, type HueMcpRunOptions } from "../mcp/server";
import type { ResourceIdentifier, RoomArchetype, ScenePut } from "../generated/types.gen";
import { createDebugFetch, enableInsecureTls, formatError, isCertificateFailure } from "../internal/bridge-runtime";
import { createCliHueClient, loadInventory, applyGroupState, applyLightState, createGroup, deleteGroup, mergeGroupMembers, recallScene, refreshGroup, resolveGroup, resolveLight, resolveMemberDeviceRefs, resolveScene, toggleLight, updateGroup, type HueInventory, type InventoryGroup } from "./hue-service";
import { createKeychainStore } from "./keychain";
import { createCliOutput, formatBooleanState } from "./output";
import { createPromptAdapter } from "./prompting";
import { getProfileConfig, loadCliConfig, resolveCliSettings, saveCliConfig, withUpdatedProfile } from "./config";
import type {
  CliDependencies,
  CliConfigFile,
  CliConfigProfile,
  GlobalCliOptions,
  GroupStateOptions,
  PromptAdapter,
  ResolvedCliSettings,
  SecretStore,
} from "./types";
import { HueCliError } from "./types";
import { createWorkflowDefinition, runWorkflow } from "./workflows";

type Runtime = {
  deps: CliDependencies;
  keychain: SecretStore;
  output: ReturnType<typeof createCliOutput>;
  prompt: PromptAdapter;
  settings: ResolvedCliSettings;
};

function pickGlobalOptions(command: Command): GlobalCliOptions {
  const options = command.optsWithGlobals() as Record<string, unknown>;
  return {
    appKey: typeof options.appKey === "string" ? options.appKey : undefined,
    bridgeUrl: typeof options.bridgeUrl === "string" ? options.bridgeUrl : undefined,
    clientKey: typeof options.clientKey === "string" ? options.clientKey : undefined,
    config: typeof options.config === "string" ? options.config : undefined,
    debugHttp: options.debugHttp === true,
    envFile: typeof options.envFile === "string" ? options.envFile : undefined,
    json: options.json === true,
    noColor: options.noColor === true,
    profile: typeof options.profile === "string" ? options.profile : undefined,
    secureTls: options.secureTls === true,
    yes: options.yes === true,
  };
}

function parseIntegerOption(value: string | undefined, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new HueCliError(`${label} must be an integer.`, { exitCode: 2 });
  }

  return parsed;
}

function collectValues(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function pickMcpOptions(command: Command): HueMcpRunOptions {
  const options = command.optsWithGlobals() as Record<string, unknown>;
  return {
    ...pickGlobalOptions(command),
    allowOrigins: Array.isArray(options.allowOrigin)
      ? options.allowOrigin.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
      : undefined,
    apiKey: typeof options.apiKey === "string" ? options.apiKey : undefined,
    apiKeyFile: typeof options.apiKeyFile === "string" ? options.apiKeyFile : undefined,
    host: typeof options.host === "string" ? options.host : undefined,
    hueAppKeyHeader: typeof options.hueAppKeyHeader === "string" ? options.hueAppKeyHeader : undefined,
    port: parseIntegerOption(typeof options.port === "string" ? options.port : undefined, "Port"),
    transport: typeof options.transport === "string" ? options.transport : undefined,
  };
}

async function createRuntime(command: Command, deps: CliDependencies): Promise<Runtime> {
  const keychain = deps.keychain ?? createKeychainStore();
  const prompt = deps.prompt ?? createPromptAdapter();
  const settings = await resolveCliSettings(pickGlobalOptions(command), { ...deps, keychain, prompt });
  return {
    deps,
    keychain,
    output: createCliOutput({
      colorEnabled: settings.colorEnabled,
      json: settings.json,
      stderr: deps.stderr,
      stdout: deps.stdout,
    }),
    prompt,
    settings,
  };
}

function parseNumber(value: string | undefined, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new HueCliError(`${label} must be a number.`, { exitCode: 2 });
  }

  return parsed;
}

function parseXY(value: string | undefined): { x: number; y: number } | undefined {
  if (!value) {
    return undefined;
  }

  const [xText, yText] = value.split(",");
  const x = Number(xText);
  const y = Number(yText);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new HueCliError("XY color must be formatted as x,y.", { exitCode: 2 });
  }
  return { x, y };
}

function buildLightState(options: Record<string, unknown>): GroupStateOptions {
  const on = options.on === true ? true : options.off === true ? false : undefined;
  return {
    brightness: parseNumber(typeof options.brightness === "string" ? options.brightness : undefined, "Brightness"),
    colorTemperatureMirek: parseNumber(typeof options.mirek === "string" ? options.mirek : undefined, "Mirek"),
    on,
    transitionMs: parseNumber(
      typeof options.transitionMs === "string" ? options.transitionMs : undefined,
      "Transition milliseconds",
    ),
    xy: parseXY(typeof options.xy === "string" ? options.xy : undefined),
  };
}

function ensureStateProvided(state: GroupStateOptions): void {
  if (
    state.brightness === undefined &&
    state.colorTemperatureMirek === undefined &&
    state.on === undefined &&
    state.transitionMs === undefined &&
    state.xy === undefined
  ) {
    throw new HueCliError("Provide at least one state option.", { exitCode: 2 });
  }
}

async function confirmAction(runtime: Runtime, message: string): Promise<void> {
  if (runtime.settings.yes) {
    return;
  }
  if (!runtime.settings.isInteractive) {
    throw new HueCliError(`${message} Pass --yes to confirm.`, { exitCode: 2 });
  }
  const confirmed = await runtime.prompt.confirm(message, false);
  if (!confirmed) {
    throw new HueCliError("Action cancelled.", { exitCode: 2 });
  }
}

function saveConfig(runtime: Runtime, config: CliConfigFile): void {
  saveCliConfig(runtime.settings.configPath, config);
  runtime.settings.config = config;
  runtime.settings.profile.settings = getProfileConfig(config, runtime.settings.profile.name);
}

function updateProfileConfig(runtime: Runtime, updater: (current: CliConfigProfile) => CliConfigProfile): void {
  saveConfig(runtime, withUpdatedProfile(runtime.settings.config, runtime.settings.profile.name, updater));
}

function recordRecentTarget(runtime: Runtime, kind: keyof NonNullable<CliConfigProfile["recentTargets"]>, id: string): void {
  updateProfileConfig(runtime, (current) => {
    const existing = current.recentTargets?.[kind] ?? [];
    return {
      ...current,
      recentTargets: {
        ...(current.recentTargets ?? {}),
        [kind]: [id, ...existing.filter((entry) => entry !== id)].slice(0, 5),
      },
    };
  });
}

function printLightTable(runtime: Runtime, inventory: HueInventory): void {
  runtime.output.table(
    [
      { key: "name", label: "Light" },
      { key: "location", label: "Location" },
      { align: "right", key: "brightness", label: "Bright" },
      { key: "state", label: "State" },
    ],
    inventory.lights.map((light) => ({
      brightness: light.brightness !== undefined ? `${Math.round(light.brightness)}%` : runtime.output.muted("-"),
      location: light.location,
      name: light.name,
      state: formatBooleanState(light.on, runtime.settings.colorEnabled),
    })),
  );
}

function printGroupTable(runtime: Runtime, groups: InventoryGroup[]): void {
  runtime.output.table(
    [
      { key: "name", label: "Name" },
      { key: "archetype", label: "Archetype" },
      { align: "right", key: "members", label: "Members" },
      { align: "right", key: "lights", label: "Lights" },
      { key: "state", label: "State" },
    ],
    groups.map((group) => ({
      archetype: group.archetype,
      lights: String(group.lightIds.length),
      members: String(group.deviceIds.length),
      name: group.name,
      state: formatBooleanState(group.on, runtime.settings.colorEnabled),
    })),
  );
}

function printSceneTable(runtime: Runtime, inventory: HueInventory): void {
  const groupNames = new Map<string, string>();
  for (const room of inventory.rooms) {
    groupNames.set(room.id, room.name);
  }
  for (const zone of inventory.zones) {
    groupNames.set(zone.id, zone.name);
  }

  runtime.output.table(
    [
      { key: "name", label: "Scene" },
      { key: "group", label: "Group" },
      { key: "id", label: "ID" },
    ],
    inventory.scenes.map((scene) => ({
      group: groupNames.get(scene.groupId) ?? scene.groupId,
      id: scene.id,
      name: scene.name,
    })),
  );
}

async function requireInventory(runtime: Runtime) {
  const client = createCliHueClient(runtime.settings, runtime.deps);
  const inventory = await loadInventory(client);
  return { client, inventory };
}

function printGroupDetails(runtime: Runtime, group: InventoryGroup): void {
  runtime.output.line(`Name: ${group.name}`);
  runtime.output.line(`Type: ${group.kind}`);
  runtime.output.line(`Archetype: ${group.archetype}`);
  runtime.output.line(`Members: ${group.deviceIds.length}`);
  runtime.output.line(`Lights: ${group.lightIds.length}`);
  runtime.output.line(`Grouped light: ${group.groupedLightId ?? "-"}`);
  runtime.output.line(`State: ${group.on === undefined ? "-" : group.on ? "on" : "off"}`);
}

function printLightDetails(runtime: Runtime, inventory: HueInventory, lightId: string): void {
  const light = inventory.lights.find((entry) => entry.id === lightId)!;
  runtime.output.line(`Name: ${light.name}`);
  runtime.output.line(`ID: ${light.id}`);
  runtime.output.line(`Device: ${light.deviceId}`);
  runtime.output.line(`Location: ${light.location}`);
  runtime.output.line(`State: ${light.on ? "on" : "off"}`);
  runtime.output.line(`Brightness: ${light.brightness !== undefined ? `${Math.round(light.brightness)}%` : "-"}`);
}

async function selectBridge(runtime: Runtime, explicitBridgeUrl?: string): Promise<string> {
  if (explicitBridgeUrl) {
    return explicitBridgeUrl;
  }

  const bridges = await discoverHueBridges();
  if (bridges.length === 0) {
    throw new HueCliError("No Hue bridges discovered.", { exitCode: 1 });
  }
  if (bridges.length === 1) {
    return bridges[0]!.baseUrl;
  }
  if (!runtime.settings.isInteractive) {
    throw new HueCliError(
      `Multiple bridges discovered: ${bridges.map((bridge) => bridge.baseUrl).join(", ")}. Use --bridge-url.`,
      { exitCode: 2 },
    );
  }

  const selected = await runtime.prompt.select(
    "Select bridge",
    bridges.map((bridge) => ({ description: bridge.id, title: bridge.baseUrl, value: bridge.baseUrl })),
  );
  if (!selected) {
    throw new HueCliError("No bridge selected.", { exitCode: 2 });
  }
  return selected;
}

async function runUi(runtime: Runtime): Promise<void> {
  while (true) {
    const selection = await runtime.prompt.select("Hue CLI", [
      { title: "Status", value: "status" },
      { title: "Light toggle", value: "light-toggle" },
      { title: "Room on", value: "room-on" },
      { title: "Room off", value: "room-off" },
      { title: "Zone on", value: "zone-on" },
      { title: "Zone off", value: "zone-off" },
      { title: "Scene recall", value: "scene" },
      { title: "Run workflow", value: "workflow" },
      { title: "Exit", value: "exit" },
    ]);

    if (!selection || selection === "exit") {
      return;
    }

    const { client, inventory } = await requireInventory(runtime);
    switch (selection) {
      case "light-toggle": {
        const light = await resolveLight(inventory, undefined, runtime.prompt);
        await toggleLight(client, light);
        recordRecentTarget(runtime, "lights", light.id);
        runtime.output.success(`Toggled ${light.name}.`);
        break;
      }
      case "room-off": {
        const room = await resolveGroup(inventory, "room", undefined, runtime.prompt);
        await applyGroupState(client, room, { on: false });
        recordRecentTarget(runtime, "rooms", room.id);
        runtime.output.success(`Turned off ${room.name}.`);
        break;
      }
      case "room-on": {
        const room = await resolveGroup(inventory, "room", undefined, runtime.prompt);
        await applyGroupState(client, room, { on: true });
        recordRecentTarget(runtime, "rooms", room.id);
        runtime.output.success(`Turned on ${room.name}.`);
        break;
      }
      case "scene": {
        const scene = await resolveScene(inventory, undefined, runtime.prompt);
        await recallScene(client, scene, { action: "active" });
        recordRecentTarget(runtime, "scenes", scene.id);
        runtime.output.success(`Recalled ${scene.name}.`);
        break;
      }
      case "status":
        runtime.output.line(`Profile: ${runtime.settings.profile.name}`);
        runtime.output.line(`Bridge: ${runtime.settings.bridgeUrl ?? "<unset>"}`);
        runtime.output.line(`Lights: ${inventory.lights.length}`);
        runtime.output.line(`Rooms: ${inventory.rooms.length}`);
        runtime.output.line(`Zones: ${inventory.zones.length}`);
        runtime.output.line(`Scenes: ${inventory.scenes.length}`);
        break;
      case "workflow": {
        const workflows = runtime.settings.profile.settings.workflows ?? {};
        const names = Object.keys(workflows).sort();
        if (names.length === 0) {
          throw new HueCliError("No workflows saved for this profile.", { exitCode: 2 });
        }
        const selected = await runtime.prompt.select(
          "Run workflow",
          names.map((name) => ({ description: workflows[name]?.description, title: name, value: name })),
        );
        if (!selected) {
          throw new HueCliError("No workflow selected.", { exitCode: 2 });
        }
        await runWorkflow({ client, inventory, workflow: workflows[selected]! });
        runtime.output.success(`Ran workflow ${selected}.`);
        break;
      }
      case "zone-off": {
        const zone = await resolveGroup(inventory, "zone", undefined, runtime.prompt);
        await applyGroupState(client, zone, { on: false });
        recordRecentTarget(runtime, "zones", zone.id);
        runtime.output.success(`Turned off ${zone.name}.`);
        break;
      }
      case "zone-on": {
        const zone = await resolveGroup(inventory, "zone", undefined, runtime.prompt);
        await applyGroupState(client, zone, { on: true });
        recordRecentTarget(runtime, "zones", zone.id);
        runtime.output.success(`Turned on ${zone.name}.`);
        break;
      }
    }
  }
}

function attachGlobalOptions(program: Command): Command {
  return program
    .option("--profile <name>", "profile name to use")
    .option("--bridge-url <url>", "bridge base URL")
    .option("--app-key <key>", "Hue application key")
    .option("--client-key <key>", "Hue client key")
    .option("--config <path>", "config file path")
    .option("--env-file <path>", "explicit .env file to load")
    .option("--secure-tls", "force TLS verification")
    .option("--debug-http", "log request and response metadata")
    .option("--json", "emit JSON output")
    .option("--no-color", "disable ANSI colors")
    .option("--yes", "skip destructive confirmations");
}

function parseSceneRecallOptions(options: Record<string, unknown>): NonNullable<ScenePut["recall"]> {
  return {
    ...(typeof options.action === "string" ? { action: options.action as "active" | "dynamic_palette" | "static" } : {}),
    ...(typeof options.duration === "string" ? { duration: Number(options.duration) } : {}),
  };
}

function registerGroupCommands(program: Command, kind: "room" | "zone", deps: CliDependencies): void {
  const command = program.command(`${kind}s`).description(`${kind} management`);

  command
    .command("list")
    .action(async function () {
      const runtime = await createRuntime(this, deps);
      const { inventory } = await requireInventory(runtime);
      const groups = kind === "room" ? inventory.rooms : inventory.zones;
      if (runtime.settings.json) {
        runtime.output.json(groups.map((group) => group.raw));
        return;
      }
      printGroupTable(runtime, groups);
    });

  command
    .command("get [target]")
    .action(async function (target: string | undefined) {
      const runtime = await createRuntime(this, deps);
      const { inventory } = await requireInventory(runtime);
      const group = await resolveGroup(inventory, kind, target, runtime.settings.isInteractive ? runtime.prompt : undefined);
      if (runtime.settings.json) {
        runtime.output.json(group.raw);
        return;
      }
      printGroupDetails(runtime, group);
    });

  command
    .command("create <name> [members...]")
    .option("--archetype <archetype>", `${kind} archetype`)
    .action(async function (name: string, members: string[]) {
      const runtime = await createRuntime(this, deps);
      const { client, inventory } = await requireInventory(runtime);
      const options = this.opts() as Record<string, unknown>;
      const resolvedMembers = await resolveMemberDeviceRefs(
        inventory,
        members,
        runtime.settings.isInteractive ? runtime.prompt : undefined,
      );
      const result = await createGroup(client, kind, {
        archetype: (options.archetype as RoomArchetype | undefined) ?? "other",
        members: resolvedMembers,
        name,
      });
      if (runtime.settings.json) {
        runtime.output.json(result);
        return;
      }
      runtime.output.success(`Created ${kind} ${name}.`);
    });

  command
    .command("rename <target> <name>")
    .action(async function (target: string, name: string) {
      const runtime = await createRuntime(this, deps);
      const { client, inventory } = await requireInventory(runtime);
      const group = await resolveGroup(inventory, kind, target, runtime.settings.isInteractive ? runtime.prompt : undefined);
      const result = await updateGroup(client, kind, group.id, {
        metadata: { archetype: group.archetype, name },
      });
      if (runtime.settings.json) {
        runtime.output.json(result);
        return;
      }
      runtime.output.success(`Renamed ${kind} ${group.name} to ${name}.`);
    });

  command
    .command("delete <target>")
    .action(async function (target: string) {
      const runtime = await createRuntime(this, deps);
      const { client, inventory } = await requireInventory(runtime);
      const group = await resolveGroup(inventory, kind, target, runtime.settings.isInteractive ? runtime.prompt : undefined);
      await confirmAction(runtime, `Delete ${kind} ${group.name}?`);
      const result = await deleteGroup(client, kind, group.id);
      if (runtime.settings.json) {
        runtime.output.json(result);
        return;
      }
      runtime.output.success(`Deleted ${kind} ${group.name}.`);
    });

  for (const mode of ["assign", "add", "remove"] as const) {
    command
      .command(`${mode} <target> [members...]`)
      .action(async function (target: string, members: string[]) {
        const runtime = await createRuntime(this, deps);
        const { client, inventory } = await requireInventory(runtime);
        const group = await resolveGroup(inventory, kind, target, runtime.settings.isInteractive ? runtime.prompt : undefined);
        const resolvedMembers = await resolveMemberDeviceRefs(
          inventory,
          members,
          runtime.settings.isInteractive ? runtime.prompt : undefined,
        );
        const nextChildren = mergeGroupMembers(group, resolvedMembers, mode);
        if (mode === "assign") {
          await confirmAction(runtime, `Replace all members in ${kind} ${group.name}?`);
        }
        const result = await updateGroup(client, kind, group.id, {
          children: nextChildren,
          metadata: { archetype: group.archetype, name: group.name },
        });
        if (runtime.settings.json) {
          runtime.output.json(result);
          return;
        }
        runtime.output.success(`${mode} completed for ${kind} ${group.name}.`);
      });
  }

  command
    .command("on [target]")
    .action(async function (target: string | undefined) {
      const runtime = await createRuntime(this, deps);
      const { client, inventory } = await requireInventory(runtime);
      const group = await resolveGroup(inventory, kind, target, runtime.settings.isInteractive ? runtime.prompt : undefined);
      const result = await applyGroupState(client, group, { on: true });
      recordRecentTarget(runtime, `${kind}s` as "rooms" | "zones", group.id);
      if (runtime.settings.json) {
        runtime.output.json(result);
        return;
      }
      runtime.output.success(`Turned on ${group.name}.`);
    });

  command
    .command("off [target]")
    .action(async function (target: string | undefined) {
      const runtime = await createRuntime(this, deps);
      const { client, inventory } = await requireInventory(runtime);
      const group = await resolveGroup(inventory, kind, target, runtime.settings.isInteractive ? runtime.prompt : undefined);
      const result = await applyGroupState(client, group, { on: false });
      recordRecentTarget(runtime, `${kind}s` as "rooms" | "zones", group.id);
      if (runtime.settings.json) {
        runtime.output.json(result);
        return;
      }
      runtime.output.success(`Turned off ${group.name}.`);
    });

  command
    .command("set [target]")
    .option("--brightness <value>", "brightness percentage")
    .option("--mirek <value>", "color temperature in mirek")
    .option("--xy <x,y>", "color in x,y form")
    .option("--on", "turn on")
    .option("--off", "turn off")
    .option("--transition-ms <value>", "transition duration in milliseconds")
    .action(async function (target: string | undefined) {
      const runtime = await createRuntime(this, deps);
      const options = this.opts() as Record<string, unknown>;
      const state = buildLightState(options);
      ensureStateProvided(state);
      const { client, inventory } = await requireInventory(runtime);
      const group = await resolveGroup(inventory, kind, target, runtime.settings.isInteractive ? runtime.prompt : undefined);
      const result = await applyGroupState(client, group, state);
      recordRecentTarget(runtime, `${kind}s` as "rooms" | "zones", group.id);
      if (runtime.settings.json) {
        runtime.output.json(result);
        return;
      }
      runtime.output.success(`Updated ${kind} ${group.name}.`);
    });
}

export function createHueProgram(deps: CliDependencies = {}): Command {
  const program = attachGlobalOptions(new Command())
    .name("hue")
    .description("Interactive Philips Hue CLI built on newhue-client")
    .showHelpAfterError()
    .exitOverride();

  program
    .command("status")
    .action(async function () {
      const runtime = await createRuntime(this, deps);
      if (!runtime.settings.bridgeUrl || !runtime.settings.applicationKey) {
        const payload = {
          applicationKeyConfigured: Boolean(runtime.settings.applicationKey),
          bridgeUrl: runtime.settings.bridgeUrl ?? null,
          configPath: runtime.settings.configPath,
          profile: runtime.settings.profile.name,
        };
        if (runtime.settings.json) {
          runtime.output.json(payload);
          return;
        }
        runtime.output.line(`Profile: ${payload.profile}`);
        runtime.output.line(`Config: ${payload.configPath}`);
        runtime.output.line(`Bridge: ${payload.bridgeUrl ?? "<unset>"}`);
        runtime.output.line(`Application key: ${payload.applicationKeyConfigured ? "configured" : "missing"}`);
        return;
      }

      const { inventory } = await requireInventory(runtime);
      const payload = {
        bridgeUrl: runtime.settings.bridgeUrl,
        counts: {
          lights: inventory.lights.length,
          rooms: inventory.rooms.length,
          scenes: inventory.scenes.length,
          zones: inventory.zones.length,
        },
        profile: runtime.settings.profile.name,
      };
      if (runtime.settings.json) {
        runtime.output.json(payload);
        return;
      }
      runtime.output.line(`Profile: ${payload.profile}`);
      runtime.output.line(`Bridge: ${payload.bridgeUrl}`);
      runtime.output.line(`Lights: ${payload.counts.lights}`);
      runtime.output.line(`Rooms: ${payload.counts.rooms}`);
      runtime.output.line(`Zones: ${payload.counts.zones}`);
      runtime.output.line(`Scenes: ${payload.counts.scenes}`);
    });

  program
    .command("auth")
    .option("--device-type <value>", "Hue device type")
    .option("--generate-client-key", "request an entertainment client key")
    .option("--no-save", "do not persist secrets to the OS keychain")
    .action(async function () {
      const runtime = await createRuntime(this, deps);
      const options = this.optsWithGlobals() as Record<string, unknown>;
      const bridgeUrl = await selectBridge(runtime, typeof options.bridgeUrl === "string" ? options.bridgeUrl : undefined);
      const deviceType = typeof options.deviceType === "string" ? options.deviceType : runtime.settings.deviceType;
      if (runtime.settings.allowInsecureTls) {
        enableInsecureTls({ secureTls: false }, { HUE_INSECURE_TLS: "1" });
      }
      const debugFetch = createDebugFetch(
        { debugHttp: runtime.settings.debugHttp },
        runtime.settings.env,
        runtime.deps.fetch ?? globalThis.fetch,
        runtime.deps.stderr,
      );
      const result = await authenticate({
        bridgeUrl,
        deviceType,
        ...(debugFetch ? { fetch: debugFetch } : runtime.deps.fetch ? { fetch: runtime.deps.fetch } : {}),
        generateClientKey: options.generateClientKey === true,
        userAgent: "newhue-client-cli/0.1.0",
      });

      updateProfileConfig(runtime, (current) => ({
        ...current,
        bridgeUrl,
        deviceType,
      }));

      if (options.save !== false) {
        await runtime.keychain.set(runtime.settings.profile.name, result);
      }

      if (runtime.settings.json) {
        runtime.output.json({ bridgeUrl, deviceType, ...result, saved: options.save !== false });
        return;
      }
      runtime.output.success(`Authenticated profile ${runtime.settings.profile.name}.`);
      runtime.output.line(`Bridge: ${bridgeUrl}`);
      runtime.output.line(`Application key: ${result.applicationKey}`);
      if (result.clientKey) {
        runtime.output.line(`Client key: ${result.clientKey}`);
      }
      if (options.save === false) {
        runtime.output.warn("Secrets were not saved to the OS keychain.");
      }
    });

  const profile = program.command("profile").description("profile management");
  profile
    .command("list")
    .action(async function () {
      const runtime = await createRuntime(this, deps);
      const names = Object.keys(runtime.settings.config.profiles ?? {}).sort();
      const rows = await Promise.all(
        names.map(async (name) => ({
          default: runtime.settings.config.defaultProfile === name ? "*" : "",
          name,
          savedKey: (await runtime.keychain.has(name)) ? "yes" : "no",
        })),
      );
      if (runtime.settings.json) {
        runtime.output.json(rows);
        return;
      }
      runtime.output.table(
        [
          { key: "default", label: "Default" },
          { key: "name", label: "Profile" },
          { key: "savedKey", label: "Saved Key" },
        ],
        rows,
      );
    });

  profile
    .command("show [name]")
    .action(async function (name: string | undefined) {
      const runtime = await createRuntime(this, deps);
      const profileName = name ?? runtime.settings.profile.name;
      const settings = getProfileConfig(runtime.settings.config, profileName);
      const payload = {
        hasSecrets: await runtime.keychain.has(profileName),
        name: profileName,
        settings,
      };
      if (runtime.settings.json) {
        runtime.output.json(payload);
        return;
      }
      runtime.output.line(`Profile: ${payload.name}`);
      runtime.output.line(`Bridge: ${payload.settings.bridgeUrl ?? "<unset>"}`);
      runtime.output.line(`Device type: ${payload.settings.deviceType ?? "<unset>"}`);
      runtime.output.line(`Insecure TLS: ${payload.settings.insecureTls ?? true}`);
      runtime.output.line(`Debug HTTP: ${payload.settings.debugHttp ?? false}`);
      runtime.output.line(`Saved secrets: ${payload.hasSecrets ? "yes" : "no"}`);
      runtime.output.line(`Workflows: ${Object.keys(payload.settings.workflows ?? {}).length}`);
    });

  profile
    .command("use <name>")
    .action(async function (name: string) {
      const runtime = await createRuntime(this, deps);
      const profiles = { ...(runtime.settings.config.profiles ?? {}) };
      profiles[name] = profiles[name] ?? {};
      saveConfig(runtime, {
        ...runtime.settings.config,
        defaultProfile: name,
        profiles,
      });
      runtime.output.success(`Default profile set to ${name}.`);
    });

  profile
    .command("remove <name>")
    .action(async function (name: string) {
      const runtime = await createRuntime(this, deps);
      await confirmAction(runtime, `Remove profile ${name}?`);
      const profiles = { ...(runtime.settings.config.profiles ?? {}) };
      delete profiles[name];
      await runtime.keychain.delete(name);
      const remaining = Object.keys(profiles).sort();
      saveConfig(runtime, {
        ...runtime.settings.config,
        defaultProfile: runtime.settings.config.defaultProfile === name ? remaining[0] : runtime.settings.config.defaultProfile,
        profiles,
      });
      runtime.output.success(`Removed profile ${name}.`);
    });

  const lights = program.command("lights").description("light management");
  lights
    .command("list")
    .action(async function () {
      const runtime = await createRuntime(this, deps);
      const { inventory } = await requireInventory(runtime);
      if (runtime.settings.json) {
        runtime.output.json(inventory.rawLights);
        return;
      }
      printLightTable(runtime, inventory);
    });

  lights
    .command("get [target]")
    .action(async function (target: string | undefined) {
      const runtime = await createRuntime(this, deps);
      const { inventory } = await requireInventory(runtime);
      const light = await resolveLight(inventory, target, runtime.settings.isInteractive ? runtime.prompt : undefined);
      if (runtime.settings.json) {
        runtime.output.json(light.raw);
        return;
      }
      printLightDetails(runtime, inventory, light.id);
    });

  lights
    .command("on [target]")
    .action(async function (target: string | undefined) {
      const runtime = await createRuntime(this, deps);
      const { client, inventory } = await requireInventory(runtime);
      const light = await resolveLight(inventory, target, runtime.settings.isInteractive ? runtime.prompt : undefined);
      const result = await client.lights.on(light.id);
      recordRecentTarget(runtime, "lights", light.id);
      if (runtime.settings.json) {
        runtime.output.json(result);
        return;
      }
      runtime.output.success(`Turned on ${light.name}.`);
    });

  lights
    .command("off [target]")
    .action(async function (target: string | undefined) {
      const runtime = await createRuntime(this, deps);
      const { client, inventory } = await requireInventory(runtime);
      const light = await resolveLight(inventory, target, runtime.settings.isInteractive ? runtime.prompt : undefined);
      const result = await client.lights.off(light.id);
      recordRecentTarget(runtime, "lights", light.id);
      if (runtime.settings.json) {
        runtime.output.json(result);
        return;
      }
      runtime.output.success(`Turned off ${light.name}.`);
    });

  lights
    .command("toggle [target]")
    .action(async function (target: string | undefined) {
      const runtime = await createRuntime(this, deps);
      const { client, inventory } = await requireInventory(runtime);
      const light = await resolveLight(inventory, target, runtime.settings.isInteractive ? runtime.prompt : undefined);
      const result = await toggleLight(client, light);
      recordRecentTarget(runtime, "lights", light.id);
      if (runtime.settings.json) {
        runtime.output.json(result);
        return;
      }
      runtime.output.success(`Toggled ${light.name}.`);
    });

  lights
    .command("set [target]")
    .option("--brightness <value>", "brightness percentage")
    .option("--mirek <value>", "color temperature in mirek")
    .option("--xy <x,y>", "color in x,y form")
    .option("--on", "turn on")
    .option("--off", "turn off")
    .option("--transition-ms <value>", "transition duration in milliseconds")
    .action(async function (target: string | undefined) {
      const runtime = await createRuntime(this, deps);
      const options = this.opts() as Record<string, unknown>;
      const state = buildLightState(options);
      ensureStateProvided(state);
      const { client, inventory } = await requireInventory(runtime);
      const light = await resolveLight(inventory, target, runtime.settings.isInteractive ? runtime.prompt : undefined);
      const result = await applyLightState(client, light.id, state);
      recordRecentTarget(runtime, "lights", light.id);
      if (runtime.settings.json) {
        runtime.output.json(result);
        return;
      }
      runtime.output.success(`Updated ${light.name}.`);
    });

  registerGroupCommands(program, "room", deps);
  registerGroupCommands(program, "zone", deps);

  const scenes = program.command("scenes").description("scene management");
  scenes
    .command("list")
    .action(async function () {
      const runtime = await createRuntime(this, deps);
      const { inventory } = await requireInventory(runtime);
      if (runtime.settings.json) {
        runtime.output.json(inventory.scenes.map((scene) => scene.raw));
        return;
      }
      printSceneTable(runtime, inventory);
    });

  scenes
    .command("recall [target]")
    .option("--action <value>", "active, dynamic_palette, or static")
    .option("--duration <value>", "transition duration in milliseconds")
    .action(async function (target: string | undefined) {
      const runtime = await createRuntime(this, deps);
      const { client, inventory } = await requireInventory(runtime);
      const scene = await resolveScene(inventory, target, runtime.settings.isInteractive ? runtime.prompt : undefined);
      const result = await recallScene(client, scene, parseSceneRecallOptions(this.opts() as Record<string, unknown>));
      recordRecentTarget(runtime, "scenes", scene.id);
      if (runtime.settings.json) {
        runtime.output.json(result);
        return;
      }
      runtime.output.success(`Recalled ${scene.name}.`);
    });

  const workflow = program.command("workflow").description("saved CLI workflows");
  workflow
    .command("list")
    .action(async function () {
      const runtime = await createRuntime(this, deps);
      const workflows = runtime.settings.profile.settings.workflows ?? {};
      const rows = Object.entries(workflows)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, definition]) => ({
          description: definition.description ?? runtime.output.muted("-"),
          name,
          steps: String(definition.steps.length),
        }));
      if (runtime.settings.json) {
        runtime.output.json(workflows);
        return;
      }
      runtime.output.table(
        [
          { key: "name", label: "Workflow" },
          { key: "description", label: "Description" },
          { align: "right", key: "steps", label: "Steps" },
        ],
        rows,
      );
    });

  workflow
    .command("show <name>")
    .action(async function (name: string) {
      const runtime = await createRuntime(this, deps);
      const definition = runtime.settings.profile.settings.workflows?.[name];
      if (!definition) {
        throw new HueCliError(`Unknown workflow ${name}.`, { exitCode: 2 });
      }
      runtime.output.json(definition);
    });

  workflow
    .command("create <name>")
    .action(async function (name: string) {
      const runtime = await createRuntime(this, deps);
      if (!runtime.settings.isInteractive) {
        throw new HueCliError("workflow create requires an interactive terminal.", { exitCode: 2 });
      }
      const { inventory } = await requireInventory(runtime);
      const definition = await createWorkflowDefinition(runtime.prompt, inventory);
      updateProfileConfig(runtime, (current) => ({
        ...current,
        workflows: {
          ...(current.workflows ?? {}),
          [name]: definition,
        },
      }));
      runtime.output.success(`Saved workflow ${name}.`);
    });

  workflow
    .command("run <name>")
    .option("--dry-run", "show steps without writing state")
    .action(async function (name: string) {
      const runtime = await createRuntime(this, deps);
      const definition = runtime.settings.profile.settings.workflows?.[name];
      if (!definition) {
        throw new HueCliError(`Unknown workflow ${name}.`, { exitCode: 2 });
      }
      const { client, inventory } = await requireInventory(runtime);
      const executed = await runWorkflow({
        client,
        dryRun: this.opts().dryRun === true,
        inventory,
        workflow: definition,
      });
      if (runtime.settings.json) {
        runtime.output.json({ executed, name });
        return;
      }
      runtime.output.success(`${this.opts().dryRun === true ? "Planned" : "Ran"} workflow ${name}.`);
    });

  workflow
    .command("delete <name>")
    .action(async function (name: string) {
      const runtime = await createRuntime(this, deps);
      await confirmAction(runtime, `Delete workflow ${name}?`);
      updateProfileConfig(runtime, (current) => {
        const workflows = { ...(current.workflows ?? {}) };
        delete workflows[name];
        return {
          ...current,
          workflows,
        };
      });
      runtime.output.success(`Deleted workflow ${name}.`);
    });

  program
    .command("mcp")
    .description("run the Hue MCP server over stdio or HTTP")
    .option("--transport <transport>", "MCP transport: stdio or http")
    .option("--host <host>", "HTTP bind host")
    .option("--port <port>", "HTTP bind port")
    .option("--api-key <key>", "HTTP API key secret for Authorization: Bearer or X-API-Key")
    .option("--api-key-file <path>", "file containing the HTTP API key secret")
    .option("--allow-origin <origin>", "allowed Origin header for HTTP transport", collectValues, [])
    .option("--hue-app-key-header <name>", "request header used to override the downstream Hue application key")
    .action(async function () {
      await runHueMcpServer(pickMcpOptions(this), deps);
    });

  program
    .command("ui")
    .action(async function () {
      const runtime = await createRuntime(this, deps);
      if (!runtime.settings.isInteractive) {
        throw new HueCliError("The interactive UI requires a TTY.", { exitCode: 2 });
      }
      await runUi(runtime);
    });

  return program;
}

export async function runHueCli(argv: string[] = process.argv.slice(2), deps: CliDependencies = {}): Promise<number> {
  const program = createHueProgram(deps);
  try {
    if (argv.length === 0) {
      program.outputHelp();
      return 0;
    }
    await program.parseAsync(argv, { from: "user" });
    return 0;
  } catch (error) {
    const output = createCliOutput({ colorEnabled: true, json: false, stderr: deps.stderr, stdout: deps.stdout });
    if (error instanceof HueCliError) {
      output.error(error.message);
      return error.exitCode;
    }
    if (error instanceof CommanderError) {
      if (error.code === "commander.helpDisplayed") {
        return 0;
      }
      output.error(error.message);
      return error.exitCode;
    }

    output.error(formatError(error));
    if (isCertificateFailure(error)) {
      output.warn("TLS verification failed. Rerun with --secure-tls only if the Hue bridge CA is installed locally.");
    }
    return 1;
  }
}
