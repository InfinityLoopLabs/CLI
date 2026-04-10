import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  CommandPlugin,
  CommandStepRaw,
  PluginExecuteContext,
  PluginExecutionResult,
  PluginParseContext,
} from "../../types";
import { compactMessages, toRelativeLogPath } from "../../shared/report";
import { assertTemplateValue, renderTemplateValue, type TemplateValue } from "../../shared/template";
import { normalizeKey } from "../../shared/normalize-key";

type ReadPayload = {
  file: TemplateValue;
};

function parseReadPayload(rawStep: CommandStepRaw, context: PluginParseContext): ReadPayload {
  return {
    file: assertTemplateValue(rawStep.file, "file", context),
  };
}

function parseCliContent(content: string, filePath: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split(/\r?\n/);
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) {
      throw new Error(`Invalid entry in ${filePath} at line ${index + 1}: expected KEY=VALUE.`);
    }

    const key = line.slice(0, eqIndex).trim();
    const value = line.slice(eqIndex + 1).trim();
    if (!key) {
      throw new Error(`Invalid entry in ${filePath} at line ${index + 1}: key is empty.`);
    }

    result[key] = value;
  }

  return result;
}

function assignVariable(target: Record<string, string | undefined>, key: string, value: string): void {
  target[key] = value;
  const lower = key.toLowerCase();
  target[lower] = value;
  const normalized = normalizeKey(key);
  if (normalized) {
    target[normalized] = value;
  }
}

async function executeReadPayload(payload: ReadPayload, context: PluginExecuteContext): Promise<PluginExecutionResult> {
  const filePath = path.resolve(context.cwd, renderTemplateValue(payload.file, context.variables));
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      return {
        messages: [`Read skipped (file not found): ${toRelativeLogPath(context.cwd, filePath)}`],
      };
    }
    throw error;
  }
  const entries = parseCliContent(content, filePath);

  for (const [key, value] of Object.entries(entries)) {
    assignVariable(context.variables, key, value);
  }

  const loadedKeys = Object.keys(entries);
  const messages = compactMessages([
    `Loaded ${loadedKeys.length} variable(s) from ${toRelativeLogPath(context.cwd, filePath)}`,
    ...loadedKeys.map((key) => `Loaded variable: ${key}`),
  ]);
  return { messages };
}

export const readPlugin: CommandPlugin = {
  type: "read",
  parse(rawStep, context) {
    return parseReadPayload(rawStep, context);
  },
  async execute(payload, context) {
    return await executeReadPayload(payload as ReadPayload, context);
  },
};
