import { UsageError } from "../output/errors.js";
import type { CommandSpec } from "./spec.js";

export interface Parsed {
  positionals: string[];
  flags: Record<string, string | boolean>;
  help: boolean;
}

export function validFlagsHint(spec: CommandSpec): string {
  const names = [...spec.flags.map((flag) => `--${flag.name}`), "--help"];
  return `valid flags${spec.name ? ` for '${spec.name}'` : ""}: ${names.join(", ")}`;
}

export function parseArgs(argv: string[], spec: CommandSpec): Parsed {
  const flags: Record<string, string | boolean> = {};
  for (const flag of spec.flags) {
    if (flag.default !== undefined) flags[flag.name] = flag.default;
  }
  const positionals: string[] = [];
  let help = false;

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]!;
    if (token === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (token === "--help") {
      help = true;
      continue;
    }
    if (token.startsWith("--")) {
      let name = token.slice(2);
      let inline: string | undefined;
      const equals = name.indexOf("=");
      if (equals >= 0) {
        inline = name.slice(equals + 1);
        name = name.slice(0, equals);
      }
      const flag = spec.flags.find((candidate) => candidate.name === name);
      if (!flag) throw new UsageError(`unknown flag --${name}`, validFlagsHint(spec));
      if (flag.type === "boolean") {
        if (inline !== undefined) {
          throw new UsageError(`flag --${name} does not take a value`, validFlagsHint(spec));
        }
        flags[name] = true;
        continue;
      }
      let value = inline;
      if (value === undefined) {
        value = argv[index + 1];
        if (value === undefined || value.startsWith("--")) {
          throw new UsageError(`flag --${name} requires a value`, `usage: --${name} <value>`);
        }
        index++;
      }
      if (flag.values && !flag.values.includes(value)) {
        throw new UsageError(
          `invalid value '${value}' for --${name}`,
          `valid values: ${flag.values.join(", ")}`,
        );
      }
      flags[name] = value;
      continue;
    }
    if (token.startsWith("-")) {
      throw new UsageError(
        `unknown flag ${token}`,
        `${validFlagsHint(spec)} (short flags are not supported)`,
      );
    }
    positionals.push(token);
  }

  if (!help) {
    const args = spec.args ?? [];
    const required = args.filter((arg) => arg.required);
    if (positionals.length < required.length) {
      const missing = required[positionals.length]!;
      throw new UsageError(
        `missing required argument <${missing.name}>`,
        spec.examples[0] ?? `run '${spec.name} --help'`,
      );
    }
    if (positionals.length > args.length) {
      throw new UsageError(
        `unexpected argument '${positionals[args.length]}'`,
        spec.examples[0] ?? `run '${spec.name} --help'`,
      );
    }
  }
  return { positionals, flags, help };
}

export function stringFlag(parsed: Parsed, name: string): string | undefined {
  const value = parsed.flags[name];
  return typeof value === "string" ? value : undefined;
}

export function booleanFlag(parsed: Parsed, name: string): boolean {
  return parsed.flags[name] === true;
}
