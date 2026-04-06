import path from "node:path";
import { parseArgs } from "./args";
import { loadProjectConfig } from "./config";
import { createInitConfigFile } from "./init";
import { runCommandByKey } from "./runtime";
import type { Variables } from "./types";
import { builtinPlugins } from "./plugins";

export * from "./types";
export * from "./args";
export * from "./config";
export * from "./init";
export * from "./runtime";
export * from "./plugins";
export * from "./plugins/add";
export * from "./plugins/copy";
export * from "./plugins/download";
export * from "./plugins/insert";
export * from "./plugins/merge-template";
export * from "./plugins/rename";
export * from "./plugins/remove-line";
export * from "./plugins/remove";

function resolveCommandKeyAndName(options: {
  commandKey?: string;
  commandArgs?: string[];
  name?: string;
}): { commandKey?: string; name?: string; kind?: string } {
  if (options.commandKey !== "add" && options.commandKey !== "remove") {
    return {
      commandKey: options.commandKey,
      name: options.name,
    };
  }

  const [kindRaw, nameFromPositional] = options.commandArgs ?? [];
  const kind = kindRaw?.toLowerCase();
  const name = options.name ?? nameFromPositional;

  const commandLabel = options.commandKey;
  if (!kind || !name) {
    throw new Error(
      commandLabel === "add"
        ? 'Add usage: ill add <widget|service> <Name>.'
        : 'Remove usage: ill remove <widget|service> <Name>.',
    );
  }

  if (kind === "widget") {
    return {
      commandKey: commandLabel === "add" ? "addWidget" : "removeWidget",
      name,
      kind,
    };
  }
  if (kind === "service") {
    return {
      commandKey: commandLabel === "add" ? "addService" : "removeService",
      name,
      kind,
    };
  }

  throw new Error(
    `Unknown ${commandLabel} target "${kindRaw}". Allowed values: widget, service.`,
  );
}

function toLowerFirst(value: string | undefined): string | undefined {
  if (!value) {
    return value;
  }
  return `${value.charAt(0).toLowerCase()}${value.slice(1)}`;
}

export async function runCli(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: ill <commandKey> [--name <value>] [--config <path>] [--cwd <path>]");
    console.log("Add:   ill add <widget|service> <Name>");
    console.log("Remove: ill remove <widget|service> <Name>");
    console.log(
      "Init:  ill init [--repo <owner/repo|url>] [--target-repo <owner/repo|url>] [--ref <branch|tag>] [--force]",
    );
    console.log("Auto config names: infinityloop.config.js|mjs|cjs");
    console.log("Example: ill createWidget --name=Popup");
    return 0;
  }

  try {
    const options = parseArgs(args);
    if (options.commandKey === "init") {
      const { configPath } = await createInitConfigFile({
        cwd: options.cwd,
        repo: options.repo,
        targetRepo: options.targetRepo,
        ref: options.ref,
        force: options.force,
      });
      console.log(`Created config: ${path.relative(options.cwd, configPath)}`);
      return 0;
    }

    const resolved = resolveCommandKeyAndName(options);
    const { config, configPath } = await loadProjectConfig(options.cwd, options.configPath);
    const variables: Variables = {
      name: resolved.name,
      nameLower: toLowerFirst(resolved.name),
      kind: resolved.kind,
    };

    const stepsCount = await runCommandByKey(
      config,
      resolved.commandKey,
      options.cwd,
      variables,
      builtinPlugins,
      configPath,
    );

    if (configPath) {
      console.log(`Loaded config: ${path.relative(options.cwd, configPath)}`);
    }
    console.log(`Command: ${resolved.commandKey}`);
    console.log(`Steps executed: ${stepsCount}`);

    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`CLI error: ${message}`);
    return 1;
  }
}
