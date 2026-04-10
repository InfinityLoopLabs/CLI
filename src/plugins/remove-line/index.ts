import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  CommandPlugin,
  CommandStepRaw,
  PluginExecuteContext,
  PluginExecutionResult,
  PluginParseContext,
} from "../../types";
import { toRelativeLogPath } from "../../shared/report";
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
): Promise<PluginExecutionResult> {
  const filePath = path.resolve(context.cwd, renderTemplateValue(payload.file, context.variables));
  const lineToRemove = renderTemplateValue(payload.line, context.variables).trim();

  const content = await readFile(filePath, "utf8");
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  const removedLines: number[] = [];
  const filtered = lines.filter((line, index) => {
    if (line.trim() === lineToRemove) {
      removedLines.push(index + 1);
      return false;
    }
    return true;
  });
  await writeFile(filePath, filtered.join(eol), "utf8");

  if (removedLines.length === 0) {
    return {
      messages: [
        `No matching lines removed in ${toRelativeLogPath(context.cwd, filePath)}: "${lineToRemove}"`,
      ],
    };
  }

  return {
    messages: [
      `Removed ${removedLines.length} line(s) in ${toRelativeLogPath(context.cwd, filePath)} at ${removedLines.join(", ")}`,
    ],
  };
}

export const removeLinePlugin: CommandPlugin = {
  type: "remove-line",
  parse(rawStep, context) {
    return parseRemoveLinePayload(rawStep, context);
  },
  async execute(payload, context) {
    return await executeRemoveLinePayload(payload as RemoveLinePayload, context);
  },
};
