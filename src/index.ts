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
export * from "./plugins/replace";
export * from "./plugins/rename";
export * from "./plugins/remove-line";
export * from "./plugins/remove";
export * from "./plugins/read";

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

function tokenizeName(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_\s]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map(part => part.toLowerCase());
}

function capitalize(part: string): string {
  return part.charAt(0).toUpperCase() + part.slice(1);
}

function toPascalCase(value: string | undefined): string | undefined {
  const tokens = tokenizeName(value);
  if (tokens.length === 0) {
    return value;
  }
  return tokens.map(capitalize).join("");
}

function toCamelCase(value: string | undefined): string | undefined {
  const tokens = tokenizeName(value);
  if (tokens.length === 0) {
    return value;
  }
  const [first, ...rest] = tokens;
  return [first, ...rest.map(capitalize)].join("");
}

function toSnakeCase(value: string | undefined): string | undefined {
  const tokens = tokenizeName(value);
  if (tokens.length === 0) {
    return value;
  }
  return tokens.join("_");
}

function toKebabCase(value: string | undefined): string | undefined {
  const tokens = tokenizeName(value);
  if (tokens.length === 0) {
    return value;
  }
  return tokens.join("-");
}

function toScreamingSnakeCase(value: string | undefined): string | undefined {
  const snake = toSnakeCase(value);
  return snake ? snake.toUpperCase() : value;
}

function createNameVariants(name: string | undefined): Variables {
  const pascal = toPascalCase(name);
  return {
    name,
    nameLower: toLowerFirst(name),
    namePascal: pascal,
    nameCamel: toCamelCase(name),
    nameSnake: toSnakeCase(name),
    nameKebab: toKebabCase(name),
    nameScreamingSnake: toScreamingSnakeCase(name),
  };
}

async function commandPlan(options: ReturnType<typeof parseArgs>): Promise<number> {
  const { config, configPath } = await loadProjectConfig(options.cwd, options.configPath);
  const variables: Variables = {
    ...(options.params ?? {}),
    dryRun: "true",
  };
  const stepsCount = await runCommandByKey(
    config,
    "sync",
    options.cwd,
    variables,
    builtinPlugins,
    configPath,
  );
  if (configPath) {
    console.log(`Loaded config: ${path.relative(options.cwd, configPath)}`);
  }
  console.log("Command: plan (sync dry-run)");
  console.log(`Steps executed: ${stepsCount}`);
  return 0;
}

export async function runCli(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: ill <commandKey> [--name <value>] [--config <path>] [--cwd <path>]");
    console.log("Add:   ill add <widget|service> <Name>");
    console.log("Remove: ill remove <widget|service> <Name>");
    console.log("Plan:  ill plan [--config <path>] [--cwd <path>]");
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
    if (options.commandKey === "plan") {
      return await commandPlan(options);
    }

    const resolved = resolveCommandKeyAndName(options);
    const { config, configPath } = await loadProjectConfig(options.cwd, options.configPath);
    const variables: Variables = {
      ...createNameVariants(resolved.name),
      kind: resolved.kind,
      ...(options.params ?? {}),
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
