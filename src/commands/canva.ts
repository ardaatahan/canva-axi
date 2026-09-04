import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { booleanFlag, stringFlag, type Parsed } from "../cli/args.js";
import type { CommandModule } from "../cli/router.js";
import { createApi, validateId } from "../api/client.js";
import { RuntimeError, UsageError } from "../output/errors.js";
import { emitList, formatOutput, print } from "../output/toon.js";

const outputFlags = [
  {
    name: "json",
    type: "boolean",
    description: "emit JSON instead of compact TOON",
  },
] as const;

const confirmFlag = {
  name: "confirm",
  type: "boolean",
  description: "authorize this one mutating operation",
} as const;

function output(parsed: Parsed, value: unknown): void {
  print(formatOutput(value, booleanFlag(parsed, "json")));
}

function requireConfirmation(parsed: Parsed, operation: string): void {
  if (!booleanFlag(parsed, "confirm")) {
    throw new UsageError(
      `confirmation required to ${operation}`,
      `review the operation, then rerun with --confirm`,
    );
  }
}

function integerFlag(
  parsed: Parsed,
  name: string,
  options: { min: number; max: number },
): number | undefined {
  const raw = stringFlag(parsed, name);
  if (raw === undefined) return undefined;
  if (!/^\d+$/.test(raw)) {
    throw new UsageError(`--${name} must be an integer`, `received: ${raw}`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < options.min || value > options.max) {
    throw new UsageError(
      `--${name} must be between ${options.min} and ${options.max}`,
      `received: ${raw}`,
    );
  }
  return value;
}

function pagesFlag(parsed: Parsed): number[] | undefined {
  const raw = stringFlag(parsed, "pages");
  if (raw === undefined) return undefined;
  const values = raw.split(",");
  if (
    values.length === 0 ||
    values.some((value) => !/^\d+$/.test(value) || Number(value) < 1)
  ) {
    throw new UsageError(
      "--pages must be comma-separated one-based page numbers",
      "use a value such as --pages 1,2,3",
    );
  }
  return values.map(Number);
}

function requireNonEmptyFlag(parsed: Parsed, name: string): string {
  const value = stringFlag(parsed, name)?.trim();
  if (!value) {
    throw new UsageError(`--${name} is required`, `provide --${name} <value>`);
  }
  return value;
}

function designRows(payload: Record<string, unknown>): Array<Record<string, unknown>> {
  if (!Array.isArray(payload.items)) return [];
  return payload.items.map((item) => {
    const design = item as Record<string, unknown>;
    return {
      id: design.id,
      title: design.title,
      page_count: design.page_count,
      design_types: Array.isArray(design.design_types)
        ? design.design_types.join("|")
        : "",
      updated_at: design.updated_at,
    };
  });
}

export const designsList: CommandModule = {
  spec: {
    name: "designs list",
    summary: "List design metadata",
    flags: [
      { name: "query", type: "string", description: "search term (max 255 characters)" },
      { name: "continuation", type: "string", description: "pagination token from a prior response" },
      {
        name: "ownership",
        type: "string",
        values: ["any", "owned", "shared"],
        description: "filter by ownership",
      },
      {
        name: "sort-by",
        type: "string",
        values: [
          "relevance",
          "modified_descending",
          "modified_ascending",
          "title_descending",
          "title_ascending",
        ],
        description: "sort order",
      },
      { name: "limit", type: "string", description: "number of designs (1-100)" },
      ...outputFlags,
    ],
    examples: [
      "canva-axi designs list",
      'canva-axi designs list --query "TikTok" --limit 25 --json',
    ],
  },
  async run(parsed) {
    const query = new URLSearchParams();
    const search = stringFlag(parsed, "query");
    if (search !== undefined) {
      if (!search || search.length > 255) {
        throw new UsageError("--query must contain 1-255 characters", "shorten the search term");
      }
      query.set("query", search);
    }
    for (const flag of ["continuation", "ownership", "sort-by"] as const) {
      const value = stringFlag(parsed, flag);
      if (value !== undefined) query.set(flag.replace("-", "_"), value);
    }
    const limit = integerFlag(parsed, "limit", { min: 1, max: 100 });
    if (limit !== undefined) query.set("limit", String(limit));
    const payload = await createApi().request<Record<string, unknown>>(
      "GET",
      "/v1/designs",
      { query },
    );
    if (booleanFlag(parsed, "json")) {
      output(parsed, payload);
    } else {
      const sections = [emitList("designs", designRows(payload), [
        "id",
        "title",
        "page_count",
        "design_types",
        "updated_at",
      ])];
      if (payload.continuation) sections.push(`continuation: ${String(payload.continuation)}`);
      print(sections.join("\n"));
    }
    return 0;
  },
};

function designReadCommand(
  name: "get" | "dataset" | "export-formats",
  path: (id: string) => string,
  summary: string,
): CommandModule {
  return {
    spec: {
      name: `designs ${name}`,
      summary,
      args: [{ name: "design-id", required: true, description: "Canva design ID" }],
      flags: [...outputFlags],
      examples: [`canva-axi designs ${name} DAFVztcvd9z`],
    },
    async run(parsed) {
      const id = parsed.positionals[0]!;
      validateId(id, "design ID");
      output(
        parsed,
        await createApi().request<Record<string, unknown>>("GET", path(id)),
      );
      return 0;
    },
  };
}

export const designsGet = designReadCommand(
  "get",
  (id) => `/v1/designs/${encodeURIComponent(id)}`,
  "Get metadata for one design",
);

export const designsDataset = designReadCommand(
  "dataset",
  (id) => `/v1/designs/${encodeURIComponent(id)}/dataset`,
  "Get the autofill dataset fields for a design",
);

export const designsExportFormats = designReadCommand(
  "export-formats",
  (id) => `/v1/designs/${encodeURIComponent(id)}/export-formats`,
  "Get export formats available for a design",
);

export const designsCreate: CommandModule = {
  spec: {
    name: "designs create",
    summary: "Create a blank preset or custom-size design",
    flags: [
      {
        name: "preset",
        type: "string",
        values: ["doc", "email", "presentation", "whiteboard"],
        description: "documented preset design type",
      },
      { name: "width", type: "string", description: "custom width in pixels (40-8000)" },
      { name: "height", type: "string", description: "custom height in pixels (40-8000)" },
      { name: "asset-id", type: "string", description: "optional existing Canva image asset ID" },
      { name: "title", type: "string", description: "design title (1-255 characters)" },
      confirmFlag,
      ...outputFlags,
    ],
    examples: [
      "canva-axi designs create --preset presentation --title Slides --confirm",
      'canva-axi designs create --width 1080 --height 1920 --title "TikTok slides" --confirm',
    ],
  },
  async run(parsed) {
    const preset = stringFlag(parsed, "preset");
    const width = integerFlag(parsed, "width", { min: 40, max: 8000 });
    const height = integerFlag(parsed, "height", { min: 40, max: 8000 });
    const assetId = stringFlag(parsed, "asset-id");
    const title = stringFlag(parsed, "title");
    if ((width === undefined) !== (height === undefined)) {
      throw new UsageError(
        "--width and --height must be provided together",
        "provide both custom dimensions",
      );
    }
    if (preset && width !== undefined) {
      throw new UsageError(
        "--preset cannot be combined with custom dimensions",
        "choose --preset or --width with --height",
      );
    }
    if (width !== undefined && height !== undefined && width * height > 25_000_000) {
      throw new UsageError(
        "custom design area exceeds 25,000,000 pixels",
        "reduce --width or --height",
      );
    }
    if (!preset && width === undefined && !assetId) {
      throw new UsageError(
        "a design type or image asset is required",
        "provide --preset, both --width and --height, or --asset-id",
      );
    }
    if (assetId) validateId(assetId, "asset ID");
    if (title !== undefined && (title.length < 1 || title.length > 255)) {
      throw new UsageError("--title must contain 1-255 characters", "change the design title");
    }
    requireConfirmation(parsed, "create a Canva design");
    const body: Record<string, unknown> = { type: "type_and_asset" };
    if (preset) body.design_type = { type: "preset", name: preset };
    if (width !== undefined && height !== undefined) {
      body.design_type = { type: "custom", width, height };
    }
    if (assetId) body.asset_id = assetId;
    if (title !== undefined) body.title = title;
    output(
      parsed,
      await createApi().request<Record<string, unknown>>("POST", "/v1/designs", { body }),
    );
    return 0;
  },
};

export const exportsCreate: CommandModule = {
  spec: {
    name: "exports create",
    summary: "Create an asynchronous PNG or JPEG design export job",
    args: [{ name: "design-id", required: true, description: "Canva design ID" }],
    flags: [
      {
        name: "format",
        type: "string",
        values: ["png", "jpg"],
        description: "image export format",
      },
      { name: "pages", type: "string", description: "comma-separated one-based pages" },
      { name: "width", type: "string", description: "image width in pixels (40-25000)" },
      { name: "height", type: "string", description: "image height in pixels (40-25000)" },
      { name: "quality", type: "string", description: "required JPEG quality (1-100)" },
      {
        name: "export-quality",
        type: "string",
        values: ["regular", "pro"],
        description: "Canva regular or premium export quality",
      },
      { name: "lossy", type: "boolean", description: "use lossy PNG compression (paid plans only)" },
      {
        name: "transparent-background",
        type: "boolean",
        description: "export transparent PNG background (paid plans only)",
      },
      { name: "single-image", type: "boolean", description: "merge PNG pages into one image" },
      confirmFlag,
      ...outputFlags,
    ],
    examples: [
      "canva-axi exports create DAFVztcvd9z --format png --pages 1,2 --confirm",
      "canva-axi exports create DAFVztcvd9z --format jpg --quality 90 --confirm --json",
    ],
  },
  async run(parsed) {
    const designId = parsed.positionals[0]!;
    validateId(designId, "design ID");
    const format = requireNonEmptyFlag(parsed, "format");
    const pages = pagesFlag(parsed);
    const width = integerFlag(parsed, "width", { min: 40, max: 25_000 });
    const height = integerFlag(parsed, "height", { min: 40, max: 25_000 });
    const quality = integerFlag(parsed, "quality", { min: 1, max: 100 });
    if (format === "jpg" && quality === undefined) {
      throw new UsageError(
        "--quality is required for JPEG exports",
        "provide --quality 1-100",
      );
    }
    const pngOnly = ["lossy", "transparent-background", "single-image"].some((flag) =>
      booleanFlag(parsed, flag),
    );
    if (format !== "png" && pngOnly) {
      throw new UsageError(
        "PNG-only flags cannot be used with JPEG",
        "remove --lossy, --transparent-background, and --single-image",
      );
    }
    requireConfirmation(parsed, "create a Canva export job");
    const exportFormat: Record<string, unknown> = { type: format };
    if (pages) exportFormat.pages = pages;
    if (width !== undefined) exportFormat.width = width;
    if (height !== undefined) exportFormat.height = height;
    if (quality !== undefined) exportFormat.quality = quality;
    const exportQuality = stringFlag(parsed, "export-quality");
    if (exportQuality) exportFormat.export_quality = exportQuality;
    if (booleanFlag(parsed, "lossy")) exportFormat.lossless = false;
    if (booleanFlag(parsed, "transparent-background")) {
      exportFormat.transparent_background = true;
    }
    if (booleanFlag(parsed, "single-image")) exportFormat.as_single_image = true;
    const payload = await createApi().request<Record<string, unknown>>(
      "POST",
      "/v1/exports",
      { body: { design_id: designId, format: exportFormat } },
    );
    output(parsed, payload);
    return 0;
  },
};

export const exportsGet: CommandModule = {
  spec: {
    name: "exports get",
    summary: "Get export job status and signed download URLs",
    args: [{ name: "export-id", required: true, description: "Canva export job ID" }],
    flags: [...outputFlags],
    examples: ["canva-axi exports get e08861ae-3b29-45db-8dc1-1fe0bf7f1cc8"],
  },
  async run(parsed) {
    const id = parsed.positionals[0]!;
    validateId(id, "export ID");
    output(
      parsed,
      await createApi().request<Record<string, unknown>>(
        "GET",
        `/v1/exports/${encodeURIComponent(id)}`,
      ),
    );
    return 0;
  },
};

export const exportsDownload: CommandModule = {
  spec: {
    name: "exports download",
    summary: "Download completed PNG or JPEG export pages without overwriting files",
    args: [{ name: "export-id", required: true, description: "completed Canva export job ID" }],
    flags: [
      { name: "output-dir", type: "string", description: "directory for downloaded page files" },
      {
        name: "format",
        type: "string",
        values: ["png", "jpg"],
        description: "filename extension matching the export job",
      },
      confirmFlag,
      ...outputFlags,
    ],
    examples: [
      "canva-axi exports download e08861ae-3b29-45db-8dc1-1fe0bf7f1cc8 --output-dir ./pages --format png --confirm",
    ],
  },
  async run(parsed) {
    const id = parsed.positionals[0]!;
    validateId(id, "export ID");
    const outputDir = resolve(requireNonEmptyFlag(parsed, "output-dir"));
    const format = requireNonEmptyFlag(parsed, "format");
    requireConfirmation(parsed, "write exported pages to disk");
    const api = createApi();
    const payload = await api.request<Record<string, unknown>>(
      "GET",
      `/v1/exports/${encodeURIComponent(id)}`,
    );
    const job = payload.job as Record<string, unknown> | undefined;
    if (!job || job.status !== "success" || !Array.isArray(job.urls)) {
      throw new RuntimeError(
        `export job is ${String(job?.status ?? "invalid")}, not success`,
        `run 'canva-axi exports get ${id}' until the job succeeds`,
        payload,
      );
    }
    const paths = job.urls.map((_, index) =>
      resolve(outputDir, `page-${String(index + 1).padStart(3, "0")}.${format}`),
    );
    const existing = paths.find((path) => existsSync(path));
    if (existing) {
      throw new UsageError(
        `refusing to overwrite ${existing}`,
        "choose an empty --output-dir",
      );
    }
    await mkdir(outputDir, { recursive: true });
    for (let index = 0; index < job.urls.length; index++) {
      const bytes = await api.download(String(job.urls[index]));
      await writeFile(paths[index]!, bytes, { flag: "wx" });
    }
    output(parsed, { export_id: id, files: paths });
    return 0;
  },
};

type AutofillValue =
  | { type: "text"; text: string }
  | { type: "image"; asset_id: string };

function autofillData(parsed: Parsed): Record<string, AutofillValue> {
  const raw = requireNonEmptyFlag(parsed, "data");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new UsageError("--data must be valid JSON", "provide a JSON object of text/image fields");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new UsageError("--data must be a JSON object", "map dataset field names to values");
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) {
    throw new UsageError("--data must include at least one field", "inspect 'designs dataset' first");
  }
  const result: Record<string, AutofillValue> = {};
  for (const [field, item] of entries) {
    if (!field || !item || typeof item !== "object" || Array.isArray(item)) {
      throw new UsageError(`invalid autofill field '${field}'`, "use a text or image value object");
    }
    const record = item as Record<string, unknown>;
    if (
      record.type === "text" &&
      typeof record.text === "string" &&
      Object.keys(record).every((key) => ["type", "text"].includes(key))
    ) {
      result[field] = { type: "text", text: record.text };
    } else if (
      record.type === "image" &&
      typeof record.asset_id === "string" &&
      Object.keys(record).every((key) => ["type", "asset_id"].includes(key))
    ) {
      validateId(record.asset_id, `asset ID for field ${field}`);
      result[field] = { type: "image", asset_id: record.asset_id };
    } else {
      throw new UsageError(
        `unsupported autofill value for field '${field}'`,
        "Phase A accepts only {type:'text',text:'...'} or {type:'image',asset_id:'...'}",
      );
    }
  }
  return result;
}

export const autofillsUpdate: CommandModule = {
  spec: {
    name: "autofills update",
    summary: "Update preconfigured design text/image autofill fields in place",
    args: [{ name: "design-id", required: true, description: "Canva design ID with autofill fields" }],
    flags: [
      {
        name: "data",
        type: "string",
        description: "JSON object mapping dataset fields to documented text/image values",
      },
      confirmFlag,
      ...outputFlags,
    ],
    examples: [
      `canva-axi autofills update DAFVztcvd9z --data '{"headline":{"type":"text","text":"Hello"}}' --confirm`,
    ],
  },
  async run(parsed) {
    const designId = parsed.positionals[0]!;
    validateId(designId, "design ID");
    const data = autofillData(parsed);
    requireConfirmation(parsed, "update Canva autofill fields");
    output(
      parsed,
      await createApi().request<Record<string, unknown>>("POST", "/v1/autofills", {
        body: { type: "update_design", design_id: designId, data },
      }),
    );
    return 0;
  },
};

export const autofillsGet: CommandModule = {
  spec: {
    name: "autofills get",
    summary: "Get asynchronous autofill job status and result",
    args: [{ name: "job-id", required: true, description: "Canva autofill job ID" }],
    flags: [...outputFlags],
    examples: ["canva-axi autofills get 450a76e7-f96f-43ae-9c37-0e1ce492ac72"],
  },
  async run(parsed) {
    const id = parsed.positionals[0]!;
    validateId(id, "autofill job ID");
    output(
      parsed,
      await createApi().request<Record<string, unknown>>(
        "GET",
        `/v1/autofills/${encodeURIComponent(id)}`,
      ),
    );
    return 0;
  },
};

export const allCommands: Record<string, CommandModule> = {
  "designs list": designsList,
  "designs get": designsGet,
  "designs create": designsCreate,
  "designs dataset": designsDataset,
  "designs export-formats": designsExportFormats,
  "exports create": exportsCreate,
  "exports get": exportsGet,
  "exports download": exportsDownload,
  "autofills update": autofillsUpdate,
  "autofills get": autofillsGet,
};
