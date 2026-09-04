import { RuntimeError, UsageError } from "../output/errors.js";

const DEFAULT_BASE_URL = "https://api.canva.com/rest";
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,50}$/;

export interface CanvaApi {
  request<T>(
    method: "GET" | "POST",
    path: string,
    options?: { query?: URLSearchParams; body?: Record<string, unknown> },
  ): Promise<T>;
  download(url: string): Promise<Uint8Array>;
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
  if (!["https:", "http:"].includes(parsed.protocol)) {
    throw new UsageError(
      "BASE_CANVA_CONNECT_API_URL must use HTTP or HTTPS",
      `use ${DEFAULT_BASE_URL}`,
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
      let response: Response;
      try {
        response = await fetch(url, {
          method,
          headers,
          ...(method === "POST"
            ? { body: JSON.stringify(options.body ?? {}) }
            : {}),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new RuntimeError(
          `Canva API request failed: ${message}`,
          "check network access and retry",
        );
      }
      const payload = await parseResponse(response);
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
    async download(url: string): Promise<Uint8Array> {
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
      let response: Response;
      try {
        response = await fetch(parsed, {
          method: "GET",
          headers: { Accept: "application/octet-stream" },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new RuntimeError(
          `export download failed: ${message}`,
          "retry before the 24-hour download URL expires",
        );
      }
      if (!response.ok) {
        throw new RuntimeError(
          `export download returned HTTP ${response.status}`,
          "retrieve the export job again or create a new export",
        );
      }
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}
