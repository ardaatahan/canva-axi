import { parseArgs, type Parsed } from "./args.js";
import type { CommandSpec } from "./spec.js";
import { normalizeError, UsageError } from "../output/errors.js";
import { emitBlock, emitList, print } from "../output/toon.js";

export interface CommandModule {
  spec: CommandSpec;
  run(parsed: Parsed): number | Promise<number>;
}

export interface Registry {
  tool: string;
  root: CommandModule;
  rootHelp(): string;
  commands: Record<string, CommandModule>;
}

function renderHelp(tool: string, spec: CommandSpec): string {
  const sections = [
    `command: ${[tool, spec.name].filter(Boolean).join(" ")}`,
    `summary: ${spec.summary}`,
  ];
  if (spec.args?.length) {
    sections.push(
      emitList(
        "args",
        spec.args.map((arg) => ({
          name: arg.name,
          required: arg.required ? "yes" : "no",
          description: arg.description,
        })),
        ["name", "required", "description"],
      ),
    );
  }
  sections.push(
    emitList(
      "flags",
      [
        ...spec.flags.map((flag) => ({
          flag: `--${flag.name}`,
          default: flag.default ?? "",
          description: flag.values
            ? `${flag.description} (${flag.values.join("|")})`
            : flag.description,
        })),
        { flag: "--help", default: "", description: "show this help" },
      ],
      ["flag", "default", "description"],
    ),
  );
  sections.push(emitBlock("examples", spec.examples));
  return sections.join("\n");
}

function topLevelCommands(registry: Registry): string {
  return [...new Set(Object.keys(registry.commands).map((key) => key.split(" ")[0]))]
    .sort()
    .join(", ");
}

export async function dispatch(registry: Registry, argv: string[]): Promise<number> {
  const terminator = argv.indexOf("--");
  const optionTokens = terminator === -1 ? argv : argv.slice(0, terminator);
  const json = optionTokens.includes("--json");
  try {
    const words: string[] = [];
    for (const token of argv) {
      if (token.startsWith("-")) break;
      words.push(token);
    }

    if (words.length === 1) {
      const children = Object.keys(registry.commands).filter((key) =>
        key.startsWith(`${words[0]} `),
      );
      if (children.length && optionTokens.includes("--help")) {
        print(
          emitList(
            "commands",
            children.map((key) => ({
              command: `${registry.tool} ${key}`,
              summary: registry.commands[key]!.spec.summary,
            })),
            ["command", "summary"],
          ),
        );
        return 0;
      }
    }

    let key = "";
    let consumed = 0;
    for (let count = Math.min(2, words.length); count >= 1; count--) {
      const candidate = words.slice(0, count).join(" ");
      if (registry.commands[candidate]) {
        key = candidate;
        consumed = count;
        break;
      }
    }

    if (!key) {
      if (words.length === 0) {
        const parsed = parseArgs(argv, registry.root.spec);
        if (parsed.help) {
          print(registry.rootHelp());
          return 0;
        }
        return await registry.root.run(parsed);
      }
      const first = words[0]!;
      const children = Object.keys(registry.commands).filter((candidate) =>
        candidate.startsWith(`${first} `),
      );
      if (children.length) {
        throw new UsageError(
          `'${first}' requires a subcommand`,
          `valid: ${children.map((item) => `${registry.tool} ${item}`).join(", ")}`,
        );
      }
      throw new UsageError(
        `unknown command '${words.join(" ")}'`,
        `valid commands: ${topLevelCommands(registry)}`,
      );
    }

    const command = registry.commands[key]!;
    const parsed = parseArgs(argv.slice(consumed), command.spec);
    if (parsed.help) {
      print(renderHelp(registry.tool, command.spec));
      return 0;
    }
    return await command.run(parsed);
  } catch (error) {
    const normalized = normalizeError(error);
    print(
      json
        ? JSON.stringify(
            {
              error: normalized.message,
              suggestion: normalized.suggestion,
              ...(normalized.details === undefined ? {} : { details: normalized.details }),
            },
            null,
            2,
          )
        : `error: ${normalized.message}\nsuggestion: ${normalized.suggestion}`,
    );
    return normalized.exitCode;
  }
}
