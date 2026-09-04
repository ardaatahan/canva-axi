import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatch, type Registry } from "../src/cli/router.js";
import { allCommands } from "../src/commands/canva.js";
import { homeCommand, rootHelp } from "../src/commands/home.js";
import { parseToon } from "../src/output/toon.js";
import { homeData } from "../src/skill/content.js";

const registry: Registry = {
  tool: "canva-axi",
  root: homeCommand,
  rootHelp,
  commands: allCommands,
};
const bin = fileURLToPath(new URL("../bin/canva-axi.js", import.meta.url));

function child(...args: string[]) {
  return spawnSync("node", [bin, ...args], {
    encoding: "utf8",
    env: { ...process.env, CANVA_ACCESS_TOKEN: "" },
  });
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function downloadResponse(
  body: BodyInit,
  status = 200,
  finalUrl = "https://export-download.canva.test/file",
): Response {
  const response = new Response(body, { status });
  Object.defineProperty(response, "url", { value: finalUrl });
  return response;
}

let stdout = "";
beforeEach(() => {
  stdout = "";
  process.env.CANVA_ACCESS_TOKEN = "test-oauth-access-token";
  process.env.BASE_CANVA_CONNECT_API_URL = "https://api.test/rest";
  vi.spyOn(process.stdout, "write").mockImplementation(
    ((chunk: string | Uint8Array) => {
      stdout += String(chunk);
      return true;
    }) as typeof process.stdout.write,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete process.env.CANVA_ACCESS_TOKEN;
  delete process.env.BASE_CANVA_CONNECT_API_URL;
});

describe("AXI shell contract", () => {
  it("supports credential-free home and help on every command", () => {
    expect(child().status).toBe(0);
    expect(child().stdout).toContain("capabilities[3]");
    expect(child("--help").stdout).toContain("exports download <export-id>");
    expect(child("designs", "--help").stdout).toContain("canva-axi designs create");
    for (const command of Object.keys(allCommands)) {
      const result = child(...command.split(" "), "--help");
      expect(result.status, command).toBe(0);
      expect(result.stdout, command).toContain("flags[");
      expect(result.stderr, command).toBe("");
    }
  });

  it("derives root help and capability operations from the command registry", () => {
    const help = rootHelp();
    const capabilities = homeData().capabilities;
    for (const [name, command] of Object.entries(allCommands)) {
      expect(help).toContain(command.spec.summary);
      const [group, operation] = name.split(" ") as [string, string];
      const capability = capabilities.find((item) => item.group === group);
      expect(String(capability?.operations).split(",")).toContain(operation);
    }
  });

  it("uses exit 1 for usage/config and exit 2 for API failures", async () => {
    expect(child("unknown").status).toBe(1);
    expect(child("designs", "list").status).toBe(1);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          { code: "invalid_access_token", message: "Token rejected" },
          401,
          { "x-request-id": "request-123" },
        ),
      ),
    );
    expect(await dispatch(registry, ["designs", "list"])).toBe(2);
    expect(stdout).toContain("Canva API error HTTP 401 (invalid_access_token)");
    expect(stdout).toContain("request-123");
    expect(stdout).not.toContain("test-oauth-access-token");
  });

  it("emits compact TOON by default and JSON only when requested", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          items: [
            {
              id: "DAFVztcvd9z",
              title: "TikTok",
              page_count: 3,
              design_types: ["presentation"],
              updated_at: 1692928800,
            },
          ],
        }),
      ),
    );
    expect(await dispatch(registry, ["designs", "list"])).toBe(0);
    expect(parseToon(stdout.trim()).ok).toBe(true);
    expect(stdout).toContain("designs[1]");

    stdout = "";
    expect(await dispatch(registry, ["designs", "list", "--json"])).toBe(0);
    expect(JSON.parse(stdout).items[0].id).toBe("DAFVztcvd9z");
  });
});

describe("official Canva Connect API requests with mocked HTTP", () => {
  it("lists designs with documented query parameters and bearer auth", async () => {
    let url = "";
    let init: RequestInit | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
        url = String(input);
        init = options;
        return jsonResponse({ items: [], continuation: "next-token" });
      }),
    );
    expect(
      await dispatch(registry, [
        "designs",
        "list",
        "--query",
        "slides",
        "--ownership",
        "owned",
        "--sort-by",
        "modified_descending",
        "--limit",
        "50",
      ]),
    ).toBe(0);
    expect(url).toBe(
      "https://api.test/rest/v1/designs?query=slides&ownership=owned&sort_by=modified_descending&limit=50",
    );
    expect(init?.method).toBe("GET");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer test-oauth-access-token",
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(stdout).toContain("continuation: next-token");
  });

  it("maps Canva API request timeouts to a focused runtime error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        const error = new Error("mock timeout");
        error.name = "TimeoutError";
        throw error;
      }),
    );
    expect(await dispatch(registry, ["designs", "list"])).toBe(2);
    expect(stdout).toContain("Canva API request timed out after 30 seconds");
  });

  it("rejects every HTTP API base, including local hosts, before fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const base of [
      "http://api.canva.com/rest",
      "http://localhost:3000/rest",
      "http://127.0.0.1:3000/rest",
    ]) {
      process.env.BASE_CANVA_CONNECT_API_URL = base;
      stdout = "";
      expect(await dispatch(registry, ["designs", "list"])).toBe(1);
      expect(stdout).toContain("BASE_CANVA_CONNECT_API_URL must use HTTPS");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates a documented custom blank design only after confirmation", async () => {
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) =>
      jsonResponse({ design: { id: "Dcustom" }, observed: init }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const args = [
      "designs",
      "create",
      "--width",
      "1080",
      "--height",
      "1920",
      "--title",
      "TikTok slides",
    ];
    expect(await dispatch(registry, args)).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    stdout = "";
    expect(await dispatch(registry, [...args, "--confirm"])).toBe(0);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toEqual({
      type: "type_and_asset",
      design_type: { type: "custom", width: 1080, height: 1920 },
      title: "TikTok slides",
    });
    expect(String(init?.body)).not.toContain("test-oauth-access-token");
  });

  it("rejects invalid custom dimensions before network access", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(
      await dispatch(registry, [
        "designs",
        "create",
        "--width",
        "8000",
        "--height",
        "8000",
        "--confirm",
      ]),
    ).toBe(1);
    expect(stdout).toContain("25,000,000");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates a documented per-page PNG export job", async () => {
    let observedUrl = "";
    let observedInit: RequestInit | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        observedUrl = String(input);
        observedInit = init;
        return jsonResponse({ job: { id: "export-job", status: "in_progress" } });
      }),
    );
    expect(
      await dispatch(registry, [
        "exports",
        "create",
        "DAFVztcvd9z",
        "--format",
        "png",
        "--pages",
        "1,3",
        "--width",
        "1080",
        "--confirm",
      ]),
    ).toBe(0);
    expect(observedUrl).toBe("https://api.test/rest/v1/exports");
    expect(JSON.parse(String(observedInit?.body))).toEqual({
      design_id: "DAFVztcvd9z",
      format: { type: "png", pages: [1, 3], width: 1080 },
    });
  });

  it("validates page numbers as positive int32 values before network access", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const pages of ["0", "1,", "2147483648", "9007199254740992"]) {
      stdout = "";
      expect(
        await dispatch(registry, [
          "exports",
          "create",
          "DAFVztcvd9z",
          "--format",
          "png",
          "--pages",
          pages,
          "--confirm",
        ]),
      ).toBe(1);
      expect(stdout).toContain("--pages");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires JPEG quality and rejects format-specific flags", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(
      await dispatch(registry, [
        "exports",
        "create",
        "DAFVztcvd9z",
        "--format",
        "jpg",
        "--confirm",
      ]),
    ).toBe(1);
    expect(stdout).toContain("--quality is required");
    stdout = "";
    expect(
      await dispatch(registry, [
        "exports",
        "create",
        "DAFVztcvd9z",
        "--format",
        "jpg",
        "--quality",
        "90",
        "--single-image",
        "--confirm",
      ]),
    ).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    stdout = "";
    expect(
      await dispatch(registry, [
        "exports",
        "create",
        "DAFVztcvd9z",
        "--format",
        "png",
        "--quality",
        "90",
        "--confirm",
      ]),
    ).toBe(1);
    expect(stdout).toContain("--quality is only valid for JPEG");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gets design, dataset, export formats, and async job states", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        urls.push(String(input));
        return jsonResponse({ ok: true });
      }),
    );
    for (const args of [
      ["designs", "get", "D_test"],
      ["designs", "dataset", "D_test"],
      ["designs", "export-formats", "D_test"],
      ["exports", "get", "export_job"],
      ["autofills", "get", "autofill_job"],
    ]) {
      expect(await dispatch(registry, args)).toBe(0);
    }
    expect(urls).toEqual([
      "https://api.test/rest/v1/designs/D_test",
      "https://api.test/rest/v1/designs/D_test/dataset",
      "https://api.test/rest/v1/designs/D_test/export-formats",
      "https://api.test/rest/v1/exports/export_job",
      "https://api.test/rest/v1/autofills/autofill_job",
    ]);
  });

  it("submits only documented text/image update_design autofill values", async () => {
    let body: unknown;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: unknown, init?: RequestInit) => {
        body = JSON.parse(String(init?.body));
        return jsonResponse({ job: { id: "autofill-job", status: "in_progress" } });
      }),
    );
    const data = JSON.stringify({
      headline: { type: "text", text: "Hello" },
      hero: { type: "image", asset_id: "Msd59349ff" },
    });
    expect(
      await dispatch(registry, [
        "autofills",
        "update",
        "DAFVztcvd9z",
        "--data",
        data,
        "--confirm",
      ]),
    ).toBe(0);
    expect(body).toEqual({
      type: "update_design",
      design_id: "DAFVztcvd9z",
      data: {
        headline: { type: "text", text: "Hello" },
        hero: { type: "image", asset_id: "Msd59349ff" },
      },
    });
  });

  it("rejects arbitrary autofill payloads and all writes without confirmation", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(
      await dispatch(registry, [
        "autofills",
        "update",
        "DAFVztcvd9z",
        "--data",
        '{"chart":{"type":"chart","chart_data":{}}}',
        "--confirm",
      ]),
    ).toBe(1);
    expect(
      await dispatch(registry, [
        "autofills",
        "update",
        "DAFVztcvd9z",
        "--data",
        '{"headline":{"type":"text","text":"Hello"}}',
      ]),
    ).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("downloads signed export URLs without sending the OAuth token or overwriting", async () => {
    const directory = await mkdtemp(join(tmpdir(), "canva-axi-"));
    const calls: Array<[string, RequestInit | undefined]> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        calls.push([url, init]);
        if (url.includes("/v1/exports/")) {
          return jsonResponse({
            job: {
              id: "export_job",
              status: "success",
              urls: [
                "https://export-download.canva.test/page-1",
                "https://export-download.canva.test/page-2",
              ],
            },
          });
        }
        return downloadResponse(new Uint8Array([1, 2, 3]), 200, url);
      }),
    );
    try {
      const args = [
        "exports",
        "download",
        "export_job",
        "--output-dir",
        directory,
        "--format",
        "png",
        "--confirm",
      ];
      expect(await dispatch(registry, args)).toBe(0);
      expect(readFileSync(join(directory, "page-001.png"))).toEqual(
        Buffer.from([1, 2, 3]),
      );
      expect(existsSync(join(directory, "page-002.png"))).toBe(true);
      expect(calls[1]?.[1]?.headers).not.toMatchObject({
        Authorization: expect.anything(),
      });
      expect(calls[1]?.[1]?.signal).toBeInstanceOf(AbortSignal);
      stdout = "";
      expect(await dispatch(registry, args)).toBe(1);
      expect(stdout).toContain("refusing to overwrite");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects a successful export with no valid URLs before filesystem work", async () => {
    const parent = await mkdtemp(join(tmpdir(), "canva-axi-empty-"));
    const outputDir = join(parent, "pages");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          job: { id: "export_job", status: "success", urls: [] },
        }),
      ),
    );
    try {
      expect(
        await dispatch(registry, [
          "exports",
          "download",
          "export_job",
          "--output-dir",
          outputDir,
          "--format",
          "png",
          "--confirm",
        ]),
      ).toBe(2);
      expect(stdout).toContain("no valid download URLs");
      expect(existsSync(outputDir)).toBe(false);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("maps a concurrent publish collision to the overwrite usage error", async () => {
    const directory = await mkdtemp(join(tmpdir(), "canva-axi-collision-"));
    const finalPath = join(directory, "page-001.png");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/v1/exports/")) {
          return jsonResponse({
            job: {
              id: "export_job",
              status: "success",
              urls: ["https://export-download.canva.test/page-1"],
            },
          });
        }
        await writeFile(finalPath, "concurrent writer", { flag: "wx" });
        return downloadResponse(new Uint8Array([1, 2, 3]), 200, url);
      }),
    );
    try {
      expect(
        await dispatch(registry, [
          "exports",
          "download",
          "export_job",
          "--output-dir",
          directory,
          "--format",
          "png",
          "--confirm",
        ]),
      ).toBe(1);
      expect(stdout).toContain(`refusing to overwrite ${finalPath}`);
      expect(readFileSync(finalPath, "utf8")).toBe("concurrent writer");
      expect(await readdir(directory)).toEqual(["page-001.png"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("removes staged pages after a mid-batch download failure so retry succeeds", async () => {
    const directory = await mkdtemp(join(tmpdir(), "canva-axi-failure-"));
    let failSecondPage = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/v1/exports/")) {
          return jsonResponse({
            job: {
              id: "export_job",
              status: "success",
              urls: [
                "https://export-download.canva.test/page-1",
                "https://export-download.canva.test/page-2",
              ],
            },
          });
        }
        if (url.endsWith("/page-2") && failSecondPage) {
          return downloadResponse("failed", 503, url);
        }
        return downloadResponse(new Uint8Array([1, 2, 3]), 200, url);
      }),
    );
    const args = [
      "exports",
      "download",
      "export_job",
      "--output-dir",
      directory,
      "--format",
      "png",
      "--confirm",
    ];
    try {
      expect(await dispatch(registry, args)).toBe(2);
      expect(await readdir(directory)).toEqual([]);

      failSecondPage = false;
      stdout = "";
      expect(await dispatch(registry, args)).toBe(0);
      expect(await readdir(directory)).toEqual([
        "page-001.png",
        "page-002.png",
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("refuses an HTTPS export URL that redirects to HTTP", async () => {
    const directory = await mkdtemp(join(tmpdir(), "canva-axi-redirect-"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/v1/exports/")) {
          return jsonResponse({
            job: {
              id: "export_job",
              status: "success",
              urls: ["https://export-download.canva.test/page-1"],
            },
          });
        }
        return downloadResponse(
          new Uint8Array([1, 2, 3]),
          200,
          "http://redirected.example.test/page-1",
        );
      }),
    );
    try {
      expect(
        await dispatch(registry, [
          "exports",
          "download",
          "export_job",
          "--output-dir",
          directory,
          "--format",
          "png",
          "--confirm",
        ]),
      ).toBe(2);
      expect(stdout).toContain("redirected to a non-HTTPS URL");
      expect(await readdir(directory)).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("maps export download timeouts and removes the staged file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "canva-axi-timeout-"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        if (url.includes("/v1/exports/")) {
          return jsonResponse({
            job: {
              id: "export_job",
              status: "success",
              urls: ["https://export-download.canva.test/page-1"],
            },
          });
        }
        const error = new Error("mock timeout");
        error.name = "AbortError";
        throw error;
      }),
    );
    try {
      expect(
        await dispatch(registry, [
          "exports",
          "download",
          "export_job",
          "--output-dir",
          directory,
          "--format",
          "png",
          "--confirm",
        ]),
      ).toBe(2);
      expect(stdout).toContain("export download timed out after 120 seconds");
      expect(await readdir(directory)).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
