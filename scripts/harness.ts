import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  authenticate,
  createHueClient,
  discoverHueBridges,
  HueHttpError,
} from "../src/index";

const INSECURE_TLS_ENV = "HUE_INSECURE_TLS";
const DEBUG_HTTP_ENV = "HUE_DEBUG_HTTP";
const DOT_ENV_PATH = resolve(process.cwd(), ".env");
const CERTIFICATE_ERROR_CODES = new Set([
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
]);

function parseDotEnvValue(rawValue: string): string {
  const trimmed = rawValue.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    const inner = trimmed.slice(1, -1);
    if (trimmed.startsWith('"')) {
      return inner.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t").replace(/\\"/g, '"');
    }
    return inner;
  }

  const commentIndex = trimmed.search(/\s#/);
  return commentIndex === -1 ? trimmed : trimmed.slice(0, commentIndex).trimEnd();
}

function loadDotEnv(): void {
  if (!existsSync(DOT_ENV_PATH)) {
    return;
  }

  const contents = readFileSync(DOT_ENV_PATH, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }

    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed);
    if (!match) {
      continue;
    }

    const key = match[1];
    const rawValue = match[2] ?? "";
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    process.env[key] = parseDotEnvValue(rawValue);
  }
}

loadDotEnv();

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

function shouldAllowInsecureTls(flags: Map<string, string | boolean>): boolean {
  return flags.get("insecure-tls") === true || process.env[INSECURE_TLS_ENV] === "1";
}

function shouldDebugHttp(flags: Map<string, string | boolean>): boolean {
  return flags.get("debug-http") === true || process.env[DEBUG_HTTP_ENV] === "1";
}

function redactHeaderValue(name: string, value: string): string {
  if (name.toLowerCase() !== "hue-application-key") {
    return value;
  }
  if (value.length <= 8) {
    return "<redacted>";
  }
  return `${value.slice(0, 4)}...${value.slice(-4)} (len=${value.length})`;
}

function createHarnessFetch(flags: Map<string, string | boolean>): typeof fetch | undefined {
  if (!shouldDebugHttp(flags)) {
    return undefined;
  }

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    console.error(`[harness] ${request.method} ${request.url}`);
    const headerLines = Array.from(request.headers.entries()).map(
      ([name, value]) => `${name}: ${redactHeaderValue(name, value)}`,
    );
    if (headerLines.length > 0) {
      console.error(`[harness] request headers:\n${headerLines.join("\n")}`);
    }

    const response = await fetch(request);
    console.error(`[harness] response ${response.status} ${response.statusText}`);
    return response;
  };
}

function enableInsecureTls(flags: Map<string, string | boolean>): void {
  if (!shouldAllowInsecureTls(flags)) {
    return;
  }

  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

function createClientFromEnv(flags: Map<string, string | boolean>) {
  const bridgeUrl = process.env.HUE_BRIDGE_URL;
  const applicationKey = process.env.HUE_APP_KEY;

  if (!bridgeUrl || !applicationKey) {
    throw new Error("HUE_BRIDGE_URL and HUE_APP_KEY must be set.");
  }

  enableInsecureTls(flags);

  const clientKey = process.env.HUE_CLIENT_KEY;
  const debugFetch = createHarnessFetch(flags);

  return createHueClient({
    applicationKey,
    bridgeUrl,
    ...(clientKey ? { clientKey } : {}),
    ...(debugFetch ? { fetch: debugFetch } : {}),
    userAgent: "openhue-client-harness/0.1.0",
  });
}

function collectErrorChain(error: unknown): Array<{ code?: string; message: string }> {
  const chain: Array<{ code?: string; message: string }> = [];
  let current: unknown = error;

  while (current) {
    if (current instanceof Error) {
      const code = "code" in current && typeof current.code === "string" ? current.code : undefined;
      chain.push({ code, message: current.message });
      current = "cause" in current ? current.cause : undefined;
      continue;
    }

    chain.push({ message: String(current) });
    break;
  }

  return chain;
}

function isCertificateFailure(error: unknown): boolean {
  return collectErrorChain(error).some(({ code, message }) => {
    if (code && CERTIFICATE_ERROR_CODES.has(code)) {
      return true;
    }
    return /certificate|self-signed|unable to verify/i.test(message);
  });
}

function formatHttpErrorBody(body: unknown): string | undefined {
  if (body === undefined || body === null) {
    return undefined;
  }

  if (typeof body === "string") {
    const trimmed = body.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  try {
    return JSON.stringify(body, null, 2);
  } catch {
    return String(body);
  }
}

function formatError(error: unknown): string {
  const chain = collectErrorChain(error);
  const base =
    chain.length === 0
      ? String(error)
      : chain
          .map(({ code, message }, index) => {
            const suffix = code ? ` (${code})` : "";
            return index === 0 ? `${message}${suffix}` : `caused by: ${message}${suffix}`;
          })
          .join("\n");

  if (error instanceof HueHttpError) {
    const parts = [base];
    if (error.url) {
      parts.push(`request url: ${error.url}`);
    }
    const bodyText = formatHttpErrorBody(error.body);
    if (bodyText) {
      parts.push(`response body: ${bodyText}`);
    }
    return parts.join("\n");
  }

  return base;
}

function printTlsHint(command: string | undefined): void {
  if (command === "discover") {
    return;
  }

  console.error(
    [
      "TLS verification failed.",
      "Philips Hue bridges commonly present a self-signed certificate on the local network.",
      "If you trust this bridge, retry with `--insecure-tls` or set `HUE_INSECURE_TLS=1` in `.env` or for the harness process.",
    ].join(" "),
  );
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
      enableInsecureTls(flags);
      const bridgeUrl = getFlag(flags, "bridge-url") ?? process.env.HUE_BRIDGE_URL;
      const deviceType = getFlag(flags, "device-type") ?? process.env.HUE_DEVICE_TYPE ?? "codex#openhue-client";
      const debugFetch = createHarnessFetch(flags);
      if (!bridgeUrl) {
        throw new Error("Provide --bridge-url or set HUE_BRIDGE_URL.");
      }
      printJson(
        await authenticate({
          bridgeUrl,
          deviceType,
          generateClientKey: flags.get("client-key") === true,
          ...(debugFetch ? { fetch: debugFetch } : {}),
          userAgent: "openhue-client-harness/0.1.0",
        }),
      );
      return;
    }
    case "list-lights": {
      const client = createClientFromEnv(flags);
      printJson(await client.lights.list());
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
          "  npm run harness -- auth --bridge-url https://<bridge-ip> [--device-type app#instance] [--client-key] [--insecure-tls] [--debug-http]",
          "  npm run harness -- list-lights [--insecure-tls] [--debug-http]",
          "  npm run harness -- get-light <lightId> [--insecure-tls] [--debug-http]",
          "  npm run harness -- toggle <lightId> <on|off> --write [--insecure-tls] [--debug-http]",
          "  npm run harness -- brightness <lightId> <brightness> --write [--insecure-tls] [--debug-http]",
          "  npm run harness -- scene-recall <sceneId> [active|dynamic_palette|static] --write [--insecure-tls] [--debug-http]",
          "  npm run harness -- stream-events [--since 1770336203:0] [--limit 5] [--insecure-tls] [--debug-http]",
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
