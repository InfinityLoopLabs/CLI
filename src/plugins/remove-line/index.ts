import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CommandPlugin, CommandStepRaw, PluginExecuteContext, PluginParseContext } from "../../types";
import { assertTemplateValue, renderTemplateValue, type TemplateValue } from "../../shared/template";

type RemoveLinePayload = {
  file: TemplateValue;
  line: TemplateValue;
};

function parseRemoveLinePayload(rawStep: CommandStepRaw, context: PluginParseContext): RemoveLinePayload {
  return {
    file: assertTemplateValue(rawStep.file, "file", context),
    line: assertTemplateValue(rawStep.line, "line", context),
  };
}

async function executeRemoveLinePayload(
  payload: RemoveLinePayload,
  context: PluginExecuteContext,
): Promise<void> {
  const filePath = path.resolve(context.cwd, renderTemplateValue(payload.file, context.variables));
  const lineToRemove = renderTemplateValue(payload.line, context.variables).trim();

  const content = await readFile(filePath, "utf8");
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);

  const filtered = lines.filter((line) => line.trim() !== lineToRemove);
  await writeFile(filePath, filtered.join(eol), "utf8");
}

export const removeLinePlugin: CommandPlugin = {
  type: "remove-line",
  parse(rawStep, context) {
    return parseRemoveLinePayload(rawStep, context);
  },
  async execute(payload, context) {
    await executeRemoveLinePayload(payload as RemoveLinePayload, context);
  },
};
