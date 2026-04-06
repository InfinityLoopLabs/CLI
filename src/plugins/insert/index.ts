import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CommandPlugin, CommandStepRaw, PluginExecuteContext, PluginParseContext } from "../../types";
import { assertTemplateValue, renderTemplateValue, type TemplateValue } from "../../shared/template";

type InsertPayload = {
  file: TemplateValue;
  placeholder: TemplateValue;
  line: TemplateValue;
};

function parseInsertPayload(rawStep: CommandStepRaw, context: PluginParseContext): InsertPayload {
  return {
    file: assertTemplateValue(rawStep.file, "file", context),
    placeholder: assertTemplateValue(rawStep.placeholder, "placeholder", context),
    line: assertTemplateValue(rawStep.line, "line", context),
  };
}

async function executeInsertPayload(payload: InsertPayload, context: PluginExecuteContext): Promise<void> {
  const filePath = path.resolve(context.cwd, renderTemplateValue(payload.file, context.variables));
  const placeholder = renderTemplateValue(payload.placeholder, context.variables);
  const line = renderTemplateValue(payload.line, context.variables);

  const content = await readFile(filePath, "utf8");
  if (!content.includes(placeholder)) {
    throw new Error(`Insert placeholder "${placeholder}" not found in file: ${filePath}`);
  }

  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const updated = content.replace(placeholder, `${placeholder}${eol}${line}`);
  await writeFile(filePath, updated, "utf8");
}

export const insertPlugin: CommandPlugin = {
  type: "insert",
  parse(rawStep, context) {
    return parseInsertPayload(rawStep, context);
  },
  async execute(payload, context) {
    await executeInsertPayload(payload as InsertPayload, context);
  },
};
