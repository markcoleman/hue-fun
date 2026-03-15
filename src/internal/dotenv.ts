import { existsSync, readFileSync } from "node:fs";

export function parseDotEnvValue(rawValue: string): string {
  const trimmed = rawValue.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    const inner = trimmed.slice(1, -1);
    if (trimmed.startsWith('"')) {
      return inner.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t").replace(/\\"/g, '"');
    }
    return inner;
  }

  const commentIndex = trimmed.search(/\s#/);
  return commentIndex === -1 ? trimmed : trimmed.slice(0, commentIndex).trimEnd();
}

export function parseDotEnv(contents: string): Record<string, string> {
  const values: Record<string, string> = {};

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
    if (!key) {
      continue;
    }

    values[key] = parseDotEnvValue(rawValue);
  }

  return values;
}

export function mergeDotEnvInto(target: Record<string, string | undefined>, values: Record<string, string>): void {
  for (const [key, value] of Object.entries(values)) {
    if (target[key] === undefined) {
      target[key] = value;
    }
  }
}

export function loadDotEnvFile(
  filePath: string,
  target: Record<string, string | undefined> = process.env,
): boolean {
  if (!existsSync(filePath)) {
    return false;
  }

  const contents = readFileSync(filePath, "utf8");
  mergeDotEnvInto(target, parseDotEnv(contents));
  return true;
}
