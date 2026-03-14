export interface HueErrorDetail {
  address?: string;
  description: string;
  type?: number;
}

function buildMessage(prefix: string, details: readonly HueErrorDetail[]): string {
  const descriptions = details
    .map((detail) => detail.description.trim())
    .filter((description) => description.length > 0);

  if (descriptions.length === 0) {
    return prefix;
  }

  return `${prefix}: ${descriptions.join("; ")}`;
}

/**
 * Error thrown when the bridge returns a non-2xx HTTP status.
 */
export class HueHttpError extends Error {
  readonly body: unknown;
  readonly status: number;
  readonly statusText: string;
  readonly url?: string;

  constructor(options: { body: unknown; status: number; statusText: string; url?: string }) {
    super(`Hue request failed with HTTP ${options.status} ${options.statusText}`.trim());
    this.name = "HueHttpError";
    this.body = options.body;
    this.status = options.status;
    this.statusText = options.statusText;
    this.url = options.url;
  }
}

/**
 * Error thrown when the Hue API returns an `errors` payload on a successful HTTP response.
 */
export class HueApiError extends Error {
  readonly details: readonly HueErrorDetail[];
  readonly responseBody: unknown;

  constructor(message: string, details: readonly HueErrorDetail[], responseBody: unknown) {
    super(buildMessage(message, details));
    this.name = "HueApiError";
    this.details = details;
    this.responseBody = responseBody;
  }
}

/**
 * Error thrown for authentication-specific Hue API failures.
 */
export class HueAuthError extends HueApiError {
  constructor(message: string, details: readonly HueErrorDetail[], responseBody: unknown) {
    super(message, details, responseBody);
    this.name = "HueAuthError";
  }
}

/**
 * Error thrown when bridge authentication is attempted before pressing the link button.
 */
export class HueLinkButtonNotPressedError extends HueAuthError {
  static readonly linkButtonErrorType = 101;

  constructor(details: readonly HueErrorDetail[], responseBody: unknown) {
    super("Hue link button was not pressed", details, responseBody);
    this.name = "HueLinkButtonNotPressedError";
  }
}
