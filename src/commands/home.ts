import { createRequire } from "node:module";
import type { CommandModule } from "../cli/router.js";
import { booleanFlag } from "../cli/args.js";
import { print } from "../output/toon.js";
import {
  DESCRIPTION,
  homeBody,
  homeData,
  rootHelpText,
} from "../skill/content.js";

const { version } = createRequire(import.meta.url)("../../package.json") as {
  version: string;
};

export const homeCommand: CommandModule = {
  spec: {
    name: "",
    summary: DESCRIPTION,
    flags: [
      { name: "version", type: "boolean", description: "print package version" },
      {
        name: "json",
        type: "boolean",
        description: "emit JSON instead of compact TOON",
      },
    ],
    examples: ["canva-axi", "canva-axi --version", "canva-axi --json"],
  },
  run(parsed) {
    if (booleanFlag(parsed, "version")) {
      print(
        booleanFlag(parsed, "json")
          ? JSON.stringify({ name: "canva-axi", version }, null, 2)
          : `canva-axi: ${version}`,
      );
      return 0;
    }
    print(
      booleanFlag(parsed, "json")
        ? JSON.stringify(homeData(), null, 2)
        : [`canva-axi: ${DESCRIPTION}`, homeBody()].join("\n"),
    );
    return 0;
  },
};

export function rootHelp(): string {
  return rootHelpText();
}
