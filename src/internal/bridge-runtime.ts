import { HueHttpError } from "./errors";

export const INSECURE_TLS_ENV = "HUE_INSECURE_TLS";
export const DEBUG_HTTP_ENV = "HUE_DEBUG_HTTP";

const CERTIFICATE_ERROR_CODES = new Set([
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
]);

export function shouldAllowInsecureTls(
  options: { secureTls?: boolean },
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (options.secureTls) {
    return false;
  }

  const envValue = env[INSECURE_TLS_ENV];
  if (envValue === "0" || envValue?.toLowerCase() === "false") {
    return false;
  }

  return true;
}

export function shouldDebugHttp(
  options: { debugHttp?: boolean },
  env: Record<string, string | undefined> = process.env,
): boolean {
  return options.debugHttp === true || env[DEBUG_HTTP_ENV] === "1";
}

export function redactHeaderValue(name: string, value: string): string {
  if (name.toLowerCase() !== "hue-application-key") {
    return value;
  }

  if (value.length <= 8) {
    return "<redacted>";
  }

  return `${value.slice(0, 4)}...${value.slice(-4)} (len=${value.length})`;
}

export function createDebugFetch(
  options: { debugHttp?: boolean },
  env: Record<string, string | undefined> = process.env,
  baseFetch: typeof fetch = globalThis.fetch,
  log: (line: string) => void = (line) => console.error(line),
): typeof fetch | undefined {
  if (!shouldDebugHttp(options, env)) {
    return undefined;
  }

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    log(`[hue] ${request.method} ${request.url}`);
    const headerLines = Array.from(request.headers.entries()).map(
      ([name, value]) => `${name}: ${redactHeaderValue(name, value)}`,
    );
    if (headerLines.length > 0) {
      log(`[hue] request headers:\n${headerLines.join("\n")}`);
    }

    const response = await baseFetch(request);
    log(`[hue] response ${response.status} ${response.statusText}`);
    return response;
  };
}

export function enableInsecureTls(
  options: { secureTls?: boolean },
  env: Record<string, string | undefined> = process.env,
): void {
  if (!shouldAllowInsecureTls(options, env)) {
    return;
  }

  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

export function collectErrorChain(error: unknown): Array<{ code?: string; message: string }> {
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

export function isCertificateFailure(error: unknown): boolean {
  return collectErrorChain(error).some(({ code, message }) => {
    if (code && CERTIFICATE_ERROR_CODES.has(code)) {
      return true;
    }
    return /certificate|self-signed|unable to verify/i.test(message);
  });
}

export function formatHttpErrorBody(body: unknown): string | undefined {
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

export function formatError(error: unknown): string {
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
