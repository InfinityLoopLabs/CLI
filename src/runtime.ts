import type { CommandPlugin, CommandStepRaw, PluginExecutionResult, ProjectConfig, Variables } from "./types";
import { normalizeKey } from "./shared/normalize-key";

type PluginRegistry = Map<string, CommandPlugin>;

const COLOR_PURPLE = "\u001B[38;2;157;56;231m";
const COLOR_ORANGE = "\u001B[38;2;249;121;0m";
const COLOR_RESET = "\u001B[0m";

function canUseAnsiColors(): boolean {
  return Boolean(process.stdout.isTTY);
}

function colorize(value: string, color: string): string {
  if (!canUseAnsiColors()) {
    return value;
  }
  return `${color}${value}${COLOR_RESET}`;
}

function normalizeStepLabel(stepType: string): string {
  return stepType === "merge-template" ? "merge" : stepType;
}

function resolveVariableValue(key: string, variables: Variables): string | undefined {
  if (variables[key] !== undefined) {
    return variables[key];
  }

  const normalized = normalizeKey(key);
  if (normalized && variables[normalized] !== undefined) {
    return variables[normalized];
  }

  const lowered = key.toLowerCase();
  if (variables[lowered] !== undefined) {
    return variables[lowered];
  }

  const camel = key.charAt(0).toLowerCase() + key.slice(1);
  if (variables[camel] !== undefined) {
    return variables[camel];
  }

  return undefined;
}

function evaluateCondition(condition: string, variables: Variables): boolean {
  const trimmed = condition.trim();
  if (!trimmed) {
    return true;
  }

  const negate = trimmed.startsWith("!");
  const key = negate ? trimmed.slice(1).trim() : trimmed;
  if (!key) {
    return true;
  }

  const value = resolveVariableValue(key, variables);
  const truthy = value !== undefined && value !== "" && value !== "false" && value !== "0";
  return negate ? !truthy : truthy;
}

function shouldExecuteStep(step: CommandStepRaw, variables: Variables): boolean {
  if (!step.when) {
    return true;
  }

  const conditions = Array.isArray(step.when) ? step.when : [step.when];
  return conditions.every(condition => evaluateCondition(condition, variables));
}

export function createPluginRegistry(plugins: CommandPlugin[]): PluginRegistry {
  const registry: PluginRegistry = new Map();
  for (const plugin of plugins) {
    if (registry.has(plugin.type)) {
      throw new Error(`Duplicate plugin type "${plugin.type}" in plugin registry.`);
    }
    registry.set(plugin.type, plugin);
  }
  return registry;
}

function printStepResult(stepType: string, result?: PluginExecutionResult | void): void {
  if (!result?.messages || result.messages.length === 0) {
    return;
  }

  const label = normalizeStepLabel(stepType);
  const coloredLabel = colorize(`[${label}]`, COLOR_PURPLE);
  for (const message of result.messages) {
    const coloredMessage = colorize(message, COLOR_ORANGE);
    console.log(`${coloredLabel} ${coloredMessage}`);
  }
}

function getPluginOrThrow(registry: PluginRegistry, type: string, contextMessage: string): CommandPlugin {
  const plugin = registry.get(type);
  if (plugin) {
    return plugin;
  }

  const available = Array.from(registry.keys()).sort();
  const availableText = available.length > 0 ? available.join(", ") : "<empty>";
  throw new Error(`${contextMessage}. Available plugin types: ${availableText}.`);
}

export async function runCommandByKey(
  config: ProjectConfig,
  commandKey: string | undefined,
  cwd: string,
  variables: Variables,
  plugins: CommandPlugin[],
  configPathForErrors = "infinityloop.config.*",
): Promise<number> {
  if (!commandKey) {
    throw new Error("Command key is required. Usage: ill <commandKey> --name=<value>.");
  }

  const commands = config.commands ?? {};
  const steps = commands[commandKey];
  if (!steps) {
    const keys = Object.keys(commands).sort();
    const keysText = keys.length > 0 ? keys.join(", ") : "<empty>";
    throw new Error(`Unknown command key "${commandKey}". Available keys: ${keysText}.`);
  }

  const registry = createPluginRegistry(plugins);
  let executedSteps = 0;
  for (const [stepIndex, step] of steps.entries()) {
    if (!shouldExecuteStep(step as CommandStepRaw, variables)) {
      continue;
    }
    const plugin = getPluginOrThrow(
      registry,
      step.type,
      `Unknown command type "${step.type}" at commands["${commandKey}"][${stepIndex}]`,
    );
    const payload = plugin.parse(step as CommandStepRaw, {
      configPath: configPathForErrors,
      commandKey,
      stepIndex,
    });
    const result = await plugin.execute(payload, { cwd, variables });
    printStepResult(step.type, result);
    executedSteps += 1;
  }

  return executedSteps;
}
