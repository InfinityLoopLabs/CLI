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

type ReplacePayload = {
  file: TemplateValue;
  search: TemplateValue;
  replace: TemplateValue;
  optional: boolean;
};

function parseReplacePayload(rawStep: CommandStepRaw, context: PluginParseContext): ReplacePayload {
  return {
    file: assertTemplateValue(rawStep.file, "file", context),
    search: assertTemplateValue(rawStep.search, "search", context),
    replace: assertTemplateValue(rawStep.replace, "replace", context),
    optional: Boolean(rawStep.optional),
  };
}

async function executeReplacePayload(
  payload: ReplacePayload,
  context: PluginExecuteContext,
): Promise<PluginExecutionResult> {
  const filePath = path.resolve(context.cwd, renderTemplateValue(payload.file, context.variables));
  const searchValue = renderTemplateValue(payload.search, context.variables);
  const replaceValue = renderTemplateValue(payload.replace, context.variables);

  const content = await readFile(filePath, "utf8");
  const searchIndex = content.indexOf(searchValue);
  if (searchIndex === -1) {
    if (payload.optional) {
      return {
        messages: [
          `Replace skipped (optional, no match) in ${toRelativeLogPath(context.cwd, filePath)}: "${searchValue}"`,
        ],
      };
    }
    throw new Error(`Replace target "${searchValue}" not found in file: ${filePath}`);
  }

  const lineNumber = content.slice(0, searchIndex).split(/\r?\n/).length;
  const updated = content.replace(searchValue, replaceValue);
  await writeFile(filePath, updated, "utf8");

  return {
    messages: [
      `Replaced first match in ${toRelativeLogPath(context.cwd, filePath)}:${lineNumber}`,
    ],
  };
}

export const replacePlugin: CommandPlugin = {
  type: "replace",
  parse(rawStep, context) {
    return parseReplacePayload(rawStep, context);
  },
  async execute(payload, context) {
    return await executeReplacePayload(payload as ReplacePayload, context);
  },
};
