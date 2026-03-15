import type { Error as ApiErrorEntry } from "../generated/types.gen";
import { HueApiError, HueHttpError, type HueErrorDetail } from "./errors";

export type GeneratedFieldsResult<T> = {
  data?: T;
  error?: unknown;
  request: Request;
  response?: Response;
};

export function extractHueErrorDetails(payload: unknown): HueErrorDetail[] {
  if (!payload) {
    return [];
  }

  if (Array.isArray(payload)) {
    return payload.flatMap((entry) => {
      if (typeof entry !== "object" || entry === null || !("error" in entry)) {
        return [];
      }

      const error = (entry as { error?: { address?: string; description?: string; type?: number } }).error;
      if (!error?.description) {
        return [];
      }

      return [{ address: error.address, description: error.description, type: error.type }];
    });
  }

  if (typeof payload !== "object" || payload === null || !("errors" in payload)) {
    return [];
  }

  const errors = (payload as { errors?: ApiErrorEntry[] }).errors;
  if (!Array.isArray(errors)) {
    return [];
  }

  return errors
    .filter((error) => typeof error?.description === "string")
    .map((error) => ({ description: error.description }));
}

export function normalizeFailure(result: GeneratedFieldsResult<unknown>): never {
  if (result.response) {
    throw new HueHttpError({
      body: result.error,
      status: result.response.status,
      statusText: result.response.statusText,
      url: result.request.url,
    });
  }

  if (result.error instanceof Error) {
    throw result.error;
  }

  throw new Error(`Hue request failed for ${result.request.url}`);
}

export function unwrapResult<T>(result: GeneratedFieldsResult<T>, operation: string): T {
  if (result.error !== undefined) {
    normalizeFailure(result as GeneratedFieldsResult<unknown>);
  }

  if (result.data === undefined) {
    throw new Error(`${operation} did not return a response body.`);
  }

  return result.data;
}

export function unwrapApiData<T>(
  result: GeneratedFieldsResult<{ data?: T[]; errors?: ApiErrorEntry[] }>,
  operation: string,
): T[] {
  const payload = unwrapResult(result, operation);
  const details = extractHueErrorDetails(payload);
  if (details.length > 0) {
    throw new HueApiError(`Hue API reported an error during ${operation}`, details, payload);
  }
  return payload.data ?? [];
}

export function unwrapSingleResource<T extends { id: string }>(items: T[], id: string, operation: string): T {
  const match = items.find((item) => item.id === id);
  if (!match) {
    throw new Error(`${operation} did not return the requested resource ${id}.`);
  }
  return match;
}
