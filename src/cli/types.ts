import type { ResourceIdentifier, RoomArchetype } from "../generated/types.gen";
import type { HueGroupedLightStateInput, HueLightStateInput } from "../index";

export type WorkflowStep =
  | ({ kind: "light.set"; targetId: string } & HueLightStateInput)
  | ({ kind: "room.set"; targetId: string } & HueGroupedLightStateInput)
  | ({ kind: "zone.set"; targetId: string } & HueGroupedLightStateInput)
  | {
      action?: "active" | "dynamic_palette" | "static";
      duration?: number;
      kind: "scene.recall";
      targetId: string;
    }
  | {
      kind: "delay";
      ms: number;
    };

export interface WorkflowDefinition {
  description?: string;
  steps: WorkflowStep[];
}

export interface RecentTargetState {
  lights?: string[];
  rooms?: string[];
  scenes?: string[];
  zones?: string[];
}

export interface CliConfigProfile {
  bridgeUrl?: string;
  debugHttp?: boolean;
  deviceType?: string;
  insecureTls?: boolean;
  recentTargets?: RecentTargetState;
  workflows?: Record<string, WorkflowDefinition>;
}

export interface CliConfigFile {
  defaultProfile?: string;
  profiles?: Record<string, CliConfigProfile>;
}

export interface StoredSecrets {
  applicationKey?: string;
  clientKey?: string;
}

export interface PromptChoice<T extends string = string> {
  description?: string;
  disabled?: boolean;
  title: string;
  value: T;
}

export interface PromptAdapter {
  confirm(message: string, initial?: boolean): Promise<boolean>;
  multiselect<T extends string>(message: string, choices: PromptChoice<T>[]): Promise<T[]>;
  select<T extends string>(message: string, choices: PromptChoice<T>[]): Promise<T | undefined>;
  text(message: string, initial?: string): Promise<string | undefined>;
}

export interface SecretStore {
  delete(profile: string): Promise<void>;
  get(profile: string): Promise<StoredSecrets | undefined>;
  has(profile: string): Promise<boolean>;
  isAvailable(): Promise<boolean>;
  set(profile: string, secrets: StoredSecrets): Promise<void>;
}

export interface CliDependencies {
  cwd?: string;
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  keychain?: SecretStore;
  now?: () => Date;
  prompt?: PromptAdapter;
  stderr?: (line: string) => void;
  stdinIsTTY?: boolean;
  stdout?: (line: string) => void;
  stdoutIsTTY?: boolean;
}

export interface GlobalCliOptions {
  appKey?: string;
  bridgeUrl?: string;
  clientKey?: string;
  config?: string;
  debugHttp?: boolean;
  envFile?: string;
  json?: boolean;
  noColor?: boolean;
  profile?: string;
  secureTls?: boolean;
  yes?: boolean;
}

export interface ResolvedCliProfile {
  name: string;
  secrets?: StoredSecrets;
  settings: CliConfigProfile;
}

export interface ResolvedCliSettings {
  allowInsecureTls: boolean;
  applicationKey?: string;
  bridgeUrl?: string;
  clientKey?: string;
  colorEnabled: boolean;
  config: CliConfigFile;
  configPath: string;
  debugHttp: boolean;
  deviceType: string;
  env: Record<string, string | undefined>;
  envFilePath?: string;
  isInteractive: boolean;
  json: boolean;
  profile: ResolvedCliProfile;
  yes: boolean;
}

export interface HueCliErrorOptions {
  code?: string;
  exitCode?: number;
}

export class HueCliError extends Error {
  readonly code?: string;
  readonly exitCode: number;

  constructor(message: string, options: HueCliErrorOptions = {}) {
    super(message);
    this.name = "HueCliError";
    this.code = options.code;
    this.exitCode = options.exitCode ?? 1;
  }
}

export interface GroupCreateOptions {
  archetype?: RoomArchetype;
  members?: ResourceIdentifier[];
  name: string;
}

export interface GroupStateOptions {
  brightness?: number;
  colorTemperatureMirek?: number;
  on?: boolean;
  transitionMs?: number;
  xy?: { x: number; y: number };
}
