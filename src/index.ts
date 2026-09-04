import { dispatch, type Registry } from "./cli/router.js";
import { allCommands } from "./commands/canva.js";
import { homeCommand, rootHelp } from "./commands/home.js";

const registry: Registry = {
  tool: "canva-axi",
  root: homeCommand,
  rootHelp,
  commands: allCommands,
};

process.exitCode = await dispatch(registry, process.argv.slice(2));
