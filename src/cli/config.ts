import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir, platform } from "node:os";

import { parse, stringify } from "yaml";

import { DEBUG_HTTP_ENV, INSECURE_TLS_ENV } from "../internal/bridge-runtime";
import { loadDotEnvFile } from "../internal/dotenv";
import type {
  CliConfigFile,
  CliConfigProfile,
  CliDependencies,
  GlobalCliOptions,
  RecentTargetState,
  ResolvedCliProfile,
  ResolvedCliSettings,
  WorkflowDefinition,
} from "./types";

const DEFAULT_DEVICE_TYPE = "newhue-client#cli";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function sanitizeRecentTargets(value: unknown): RecentTargetState | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const asArray = (candidate: unknown) =>
    Array.isArray(candidate) ? candidate.filter((entry): entry is string => typeof entry === "string") : undefined;

  return {
    lights: asArray(value.lights),
    rooms: asArray(value.rooms),
    scenes: asArray(value.scenes),
    zones: asArray(value.zones),
  };
}

function sanitizeProfile(value: unknown): CliConfigProfile {
  if (!isRecord(value)) {
    return {};
  }

  const workflows = isRecord(value.workflows)
    ? (Object.fromEntries(
        Object.entries(value.workflows).filter(([, entry]) => {
          return isRecord(entry) && Array.isArray(entry.steps);
        }),
      ) as Record<string, WorkflowDefinition>)
    : undefined;

  return {
    bridgeUrl: typeof value.bridgeUrl === "string" ? value.bridgeUrl : undefined,
    debugHttp: typeof value.debugHttp === "boolean" ? value.debugHttp : undefined,
    deviceType: typeof value.deviceType === "string" ? value.deviceType : undefined,
    insecureTls: typeof value.insecureTls === "boolean" ? value.insecureTls : undefined,
    recentTargets: sanitizeRecentTargets(value.recentTargets),
    workflows,
  };
}

export function getDefaultConfigPath(env: Record<string, string | undefined> = process.env): string {
  const home = homedir();
  switch (platform()) {
    case "darwin":
      return join(home, "Library", "Application Support", "newhue-client", "config.yaml");
    case "win32":
      return join(env.APPDATA ?? join(home, "AppData", "Roaming"), "newhue-client", "config.yaml");
    default:
      return join(env.XDG_CONFIG_HOME ?? join(home, ".config"), "newhue-client", "config.yaml");
  }
}

export function loadCliConfig(configPath: string): CliConfigFile {
  if (!existsSync(configPath)) {
    return {};
  }

  const raw = parse(readFileSync(configPath, "utf8")) as unknown;
  if (!isRecord(raw)) {
    return {};
  }

  const profiles = isRecord(raw.profiles)
    ? Object.fromEntries(Object.entries(raw.profiles).map(([name, entry]) => [name, sanitizeProfile(entry)]))
    : undefined;

  return {
    defaultProfile: typeof raw.defaultProfile === "string" ? raw.defaultProfile : undefined,
    profiles,
  };
}

export function saveCliConfig(configPath: string, config: CliConfigFile): void {
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, stringify(config), "utf8");
}

export function getProfileConfig(config: CliConfigFile, profileName: string): CliConfigProfile {
  return config.profiles?.[profileName] ?? {};
}

function resolveEnv(options: GlobalCliOptions, deps: CliDependencies): {
  env: Record<string, string | undefined>;
  envFilePath?: string;
} {
  const cwd = deps.cwd ?? process.cwd();
  const env = { ...(deps.env ?? process.env) };
  const explicitEnvFile = options.envFile ? resolve(cwd, options.envFile) : undefined;
  const defaultEnvFile = resolve(cwd, ".env");

  if (explicitEnvFile) {
    if (!existsSync(explicitEnvFile)) {
      throw new Error(`Env file not found: ${explicitEnvFile}`);
    }
    loadDotEnvFile(explicitEnvFile, env);
    return { env, envFilePath: explicitEnvFile };
  }

  if (existsSync(defaultEnvFile)) {
    loadDotEnvFile(defaultEnvFile, env);
    return { env, envFilePath: defaultEnvFile };
  }

  return { env };
}

function resolveAllowInsecureTls(env: Record<string, string | undefined>, profile: CliConfigProfile, secureTls?: boolean): boolean {
  if (secureTls) {
    return false;
  }

  const envValue = env[INSECURE_TLS_ENV];
  if (envValue !== undefined) {
    return envValue !== "0" && envValue.toLowerCase() !== "false";
  }

  return profile.insecureTls ?? true;
}

function resolveDebugHttp(env: Record<string, string | undefined>, profile: CliConfigProfile, debugHttp?: boolean): boolean {
  if (debugHttp === true) {
    return true;
  }

  if (env[DEBUG_HTTP_ENV] !== undefined) {
    return env[DEBUG_HTTP_ENV] === "1";
  }

  return profile.debugHttp ?? false;
}

function resolveColorEnabled(options: GlobalCliOptions, deps: CliDependencies): boolean {
  if (options.json || options.noColor) {
    return false;
  }

  const env = deps.env ?? process.env;
  if (env.NO_COLOR !== undefined) {
    return false;
  }

  return deps.stdoutIsTTY ?? process.stdout.isTTY ?? false;
}

export async function resolveCliSettings(
  options: GlobalCliOptions,
  deps: CliDependencies,
): Promise<ResolvedCliSettings> {
  const cwd = deps.cwd ?? process.cwd();
  const { env, envFilePath } = resolveEnv(options, deps);
  const configPath = options.config ? resolve(cwd, options.config) : getDefaultConfigPath(env);
  const config = loadCliConfig(configPath);
  const profileName = options.profile ?? env.HUE_PROFILE ?? config.defaultProfile ?? "default";
  const profileSettings = getProfileConfig(config, profileName);
  const secrets = await deps.keychain?.get(profileName);
  const profile: ResolvedCliProfile = {
    name: profileName,
    secrets,
    settings: profileSettings,
  };

  return {
    allowInsecureTls: resolveAllowInsecureTls(env, profileSettings, options.secureTls),
    applicationKey: options.appKey ?? env.HUE_APP_KEY ?? secrets?.applicationKey,
    bridgeUrl: options.bridgeUrl ?? env.HUE_BRIDGE_URL ?? profileSettings.bridgeUrl,
    clientKey: options.clientKey ?? env.HUE_CLIENT_KEY ?? secrets?.clientKey,
    colorEnabled: resolveColorEnabled(options, deps),
    config,
    configPath,
    debugHttp: resolveDebugHttp(env, profileSettings, options.debugHttp),
    deviceType: env.HUE_DEVICE_TYPE ?? profileSettings.deviceType ?? DEFAULT_DEVICE_TYPE,
    env,
    envFilePath,
    isInteractive: (deps.stdinIsTTY ?? process.stdin.isTTY ?? false) && !options.json,
    json: options.json === true,
    profile,
    yes: options.yes === true,
  };
}

export function withUpdatedProfile(
  config: CliConfigFile,
  profileName: string,
  updater: (current: CliConfigProfile) => CliConfigProfile,
): CliConfigFile {
  const profiles = { ...(config.profiles ?? {}) };
  profiles[profileName] = updater(profiles[profileName] ?? {});

  return {
    ...config,
    profiles,
  };
}
