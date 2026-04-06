import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CommandPlugin, CommandStepRaw, PluginExecuteContext, PluginParseContext } from "../../types";
import { assertTemplateValue, renderTemplateValue, type TemplateValue } from "../../shared/template";

type ReplacePayload = {
  file: TemplateValue;
  search: TemplateValue;
  replace: TemplateValue;
};

function parseReplacePayload(rawStep: CommandStepRaw, context: PluginParseContext): ReplacePayload {
  return {
    file: assertTemplateValue(rawStep.file, "file", context),
    search: assertTemplateValue(rawStep.search, "search", context),
    replace: assertTemplateValue(rawStep.replace, "replace", context),
  };
}

async function executeReplacePayload(payload: ReplacePayload, context: PluginExecuteContext): Promise<void> {
  const filePath = path.resolve(context.cwd, renderTemplateValue(payload.file, context.variables));
  const searchValue = renderTemplateValue(payload.search, context.variables);
  const replaceValue = renderTemplateValue(payload.replace, context.variables);

  const content = await readFile(filePath, "utf8");
  if (!content.includes(searchValue)) {
    throw new Error(`Replace target "${searchValue}" not found in file: ${filePath}`);
  }

  const updated = content.replace(searchValue, replaceValue);
  await writeFile(filePath, updated, "utf8");
}

export const replacePlugin: CommandPlugin = {
  type: "replace",
  parse(rawStep, context) {
    return parseReplacePayload(rawStep, context);
  },
  async execute(payload, context) {
    await executeReplacePayload(payload as ReplacePayload, context);
  },
};
