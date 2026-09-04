import { emitBlock, emitList } from "../output/toon.js";
import { allCommands } from "../commands/canva.js";

export const DESCRIPTION =
  "AXI-compliant Canva design and slideshow operations through the official Connect API";
export const SPEC_VERSION = "axi/1.0-2026-07";

function commandDisplay(command: (typeof allCommands)[string]): string {
  const args = (command.spec.args ?? []).map((arg) =>
    arg.required ? `<${arg.name}>` : `[<${arg.name}>]`,
  );
  return [command.spec.name, ...args].join(" ");
}

function capabilities(): Array<Record<string, string>> {
  const groups = new Map<
    string,
    { operations: string[]; confirmed: string[] }
  >();
  for (const [name, command] of Object.entries(allCommands)) {
    const [group, operation] = name.split(" ");
    if (!group || !operation) continue;
    const entry = groups.get(group) ?? { operations: [], confirmed: [] };
    entry.operations.push(operation);
    if (command.spec.flags.some((flag) => flag.name === "confirm")) {
      entry.confirmed.push(operation);
    }
    groups.set(group, entry);
  }
  return [...groups.entries()].map(([group, entry]) => {
    const confirmation =
      entry.confirmed.length > 0
        ? `${entry.confirmed.join("/")} ${
            entry.confirmed.length === 1 ? "requires" : "require"
          } --confirm`
        : "read-only";
    return {
      group,
      operations: entry.operations.join(","),
      safety:
        group === "autofills"
          ? `${confirmation}; eligible Canva plan required`
          : confirmation,
    };
  });
}

export function homeData(): {
  capabilities: Array<Record<string, string>>;
  help: string[];
} {
  return {
    capabilities: capabilities(),
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
      Object.values(allCommands).map((command) => ({
        command: commandDisplay(command),
        summary: command.spec.summary,
      })),
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
