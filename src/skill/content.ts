import { emitBlock, emitList } from "../output/toon.js";

export const DESCRIPTION =
  "AXI-compliant Canva design and slideshow operations through the official Connect API";
export const SPEC_VERSION = "axi/1.0-2026-07";

export function homeData(): {
  capabilities: Array<Record<string, string>>;
  help: string[];
} {
  return {
    capabilities: [
      {
        group: "designs",
        operations: "list,get,create,dataset,export-formats",
        safety: "create requires --confirm",
      },
      {
        group: "exports",
        operations: "create,get,download",
        safety: "create/download require --confirm",
      },
      {
        group: "autofills",
        operations: "update,get",
        safety: "dataset-backed update requires --confirm and eligible Canva plan",
      },
    ],
    help: [
      "canva-axi designs list",
      "canva-axi designs create --width 1080 --height 1920 --confirm",
      "canva-axi exports create <design-id> --format png --confirm",
      "canva-axi --help",
    ],
  };
}

export function homeBody(): string {
  const data = homeData();
  return [
    emitList("capabilities", data.capabilities, [
      "group",
      "operations",
      "safety",
    ]),
    emitBlock("help", data.help),
  ].join("\n");
}

export function rootHelpText(): string {
  return [
    `canva-axi: ${DESCRIPTION}`,
    emitList(
      "commands",
      [
        { command: "designs list", summary: "List design metadata" },
        { command: "designs get <design-id>", summary: "Get design metadata" },
        { command: "designs create", summary: "Create a blank preset/custom design" },
        { command: "designs dataset <design-id>", summary: "Inspect autofill fields" },
        {
          command: "designs export-formats <design-id>",
          summary: "Inspect available export formats",
        },
        { command: "exports create <design-id>", summary: "Start PNG/JPEG export" },
        { command: "exports get <export-id>", summary: "Get export status and URLs" },
        { command: "exports download <export-id>", summary: "Save completed image pages" },
        {
          command: "autofills update <design-id>",
          summary: "Update configured text/image fields",
        },
        { command: "autofills get <job-id>", summary: "Get autofill job status" },
      ],
      ["command", "summary"],
    ),
    emitList(
      "flags",
      [
        { flag: "--help", description: "show command help" },
        { flag: "--json", description: "emit JSON instead of compact TOON" },
        { flag: "--version", description: "print package version" },
      ],
      ["flag", "description"],
    ),
    emitBlock("examples", homeData().help),
  ].join("\n");
}

export function renderSkill(): string {
  const frontmatter = [
    "---",
    "name: canva-axi",
    `description: "${DESCRIPTION}"`,
    "---",
  ].join("\n");
  const body = [
    "# canva-axi",
    "",
    `${DESCRIPTION} (AXI spec ${SPEC_VERSION}). Install from a checkout with \`npm install && npm run build && npm link\`; without linking, use \`node bin/canva-axi.js\`. Supply a Canva OAuth bearer access token only through \`CANVA_ACCESS_TOKEN\`.`,
    "",
    "```",
    homeBody(),
    "```",
    "",
    "Every command supports `--help`; data commands support `--json`. Mutations refuse before network access unless `--confirm` is present. Autofill updates work only for fields configured in the design dataset; inspect them first with `designs dataset`.",
    "",
    "Exit codes: 0 success, 1 usage/configuration/validation error, 2 runtime or Canva API error. Default output is compact TOON on stdout.",
    "",
  ].join("\n");
  return `${frontmatter}\n\n${body}`;
}
