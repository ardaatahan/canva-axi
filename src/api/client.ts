import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { RuntimeError, UsageError } from "../output/errors.js";

const DEFAULT_BASE_URL = "https://api.canva.com/rest";
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,50}$/;
const API_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;

export interface CanvaApi {
  request<T>(
    method: "GET" | "POST",
    path: string,
    options?: { query?: URLSearchParams; body?: Record<string, unknown> },
  ): Promise<T>;
  download(url: string, destination: string): Promise<void>;
}

export function validateId(value: string, label: string): void {
  if (!ID_PATTERN.test(value)) {
    throw new UsageError(
      `invalid ${label} '${value}'`,
      `${label} must contain 1-50 letters, numbers, underscores, or hyphens`,
    );
  }
}

function requireAccessToken(): string {
  const token = process.env.CANVA_ACCESS_TOKEN?.trim();
  if (!token) {
    throw new UsageError(
      "CANVA_ACCESS_TOKEN is required",
      "generate a Canva OAuth user access token, export CANVA_ACCESS_TOKEN='<token>', and retry",
    );
  }
  return token;
}

function baseUrl(): string {
  const raw = (process.env.BASE_CANVA_CONNECT_API_URL ?? DEFAULT_BASE_URL).trim();
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new UsageError(
      "BASE_CANVA_CONNECT_API_URL is not a valid URL",
      `use ${DEFAULT_BASE_URL} (or https://api.canva.cn/rest for China)`,
    );
  }
  if (parsed.protocol !== "https:") {
    throw new UsageError(
      "BASE_CANVA_CONNECT_API_URL must use HTTPS",
      `use ${DEFAULT_BASE_URL} (HTTP and local-host exceptions are not supported)`,
    );
  }
  return raw.replace(/\/+$/, "");
}

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new RuntimeError(
      `Canva API returned non-JSON HTTP ${response.status}`,
      "retry; check Canva service status if the response persists",
    );
  }
}

function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  );
}

function timeoutError(operation: string, timeoutMs: number): RuntimeError {
  return new RuntimeError(
    `${operation} timed out after ${timeoutMs / 1000} seconds`,
    "check network access and retry",
  );
}

export function createApi(): CanvaApi {
  const token = requireAccessToken();
  return {
    async request<T>(
      method: "GET" | "POST",
      path: string,
      options: {
        query?: URLSearchParams;
        body?: Record<string, unknown>;
      } = {},
    ): Promise<T> {
      const url = new URL(`${baseUrl()}${path}`);
      if (options.query) url.search = options.query.toString();
      const headers: Record<string, string> = {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      };
      if (method === "POST") headers["Content-Type"] = "application/json";
      const signal = AbortSignal.timeout(API_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(url, {
          method,
          headers,
          signal,
          ...(method === "POST"
            ? { body: JSON.stringify(options.body ?? {}) }
            : {}),
        });
      } catch (error) {
        if (isTimeoutError(error)) {
          throw timeoutError("Canva API request", API_TIMEOUT_MS);
        }
        const message = error instanceof Error ? error.message : String(error);
        throw new RuntimeError(
          `Canva API request failed: ${message}`,
          "check network access and retry",
        );
      }
      let payload: unknown;
      try {
        payload = await parseResponse(response);
      } catch (error) {
        if (isTimeoutError(error)) {
          throw timeoutError("Canva API response", API_TIMEOUT_MS);
        }
        throw error;
      }
      if (!response.ok) {
        const record =
          payload && typeof payload === "object"
            ? (payload as Record<string, unknown>)
            : {};
        const code = record.code ? ` (${String(record.code)})` : "";
        const requestId = response.headers.get("x-request-id");
        throw new RuntimeError(
          `Canva API error HTTP ${response.status}${code}: ${String(record.message ?? response.statusText)}`,
          requestId
            ? `verify scopes and inputs; Canva request ID: ${requestId}`
            : "verify the OAuth token scopes and command inputs, then retry",
          payload,
        );
      }
      return payload as T;
    },
    async download(url: string, destination: string): Promise<void> {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new RuntimeError(
          "Canva returned an invalid export download URL",
          "create a new export job and retry",
        );
      }
      if (parsed.protocol !== "https:") {
        throw new RuntimeError(
          "Canva returned a non-HTTPS export download URL",
          "do not download it; create a new export job and retry",
        );
      }
      const signal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(parsed, {
          method: "GET",
          headers: { Accept: "application/octet-stream" },
          signal,
        });
      } catch (error) {
        if (isTimeoutError(error)) {
          throw timeoutError("export download", DOWNLOAD_TIMEOUT_MS);
        }
        const message = error instanceof Error ? error.message : String(error);
        throw new RuntimeError(
          `export download failed: ${message}`,
          "retry before the 24-hour download URL expires",
        );
      }
      let finalUrl: URL;
      try {
        finalUrl = new URL(response.url);
      } catch {
        throw new RuntimeError(
          "export download returned an invalid final response URL",
          "do not save it; create a new export job and retry",
        );
      }
      if (finalUrl.protocol !== "https:") {
        throw new RuntimeError(
          "export download redirected to a non-HTTPS URL",
          "do not save it; create a new export job and retry",
        );
      }
      if (!response.ok) {
        throw new RuntimeError(
          `export download returned HTTP ${response.status}`,
          "retrieve the export job again or create a new export",
        );
      }
      if (!response.body) {
        throw new RuntimeError(
          "export download returned an empty response body",
          "retrieve the export job again or create a new export",
        );
      }
      try {
        await pipeline(
          Readable.fromWeb(
            response.body as Parameters<typeof Readable.fromWeb>[0],
          ),
          createWriteStream(destination, { flags: "wx" }),
          { signal },
        );
      } catch (error) {
        if (isTimeoutError(error)) {
          throw timeoutError("export download", DOWNLOAD_TIMEOUT_MS);
        }
        const message = error instanceof Error ? error.message : String(error);
        throw new RuntimeError(
          `streaming export download failed: ${message}`,
          "retry before the 24-hour download URL expires",
        );
      }
    },
  };
}
