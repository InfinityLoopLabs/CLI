import { rm, stat } from "node:fs/promises";
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

type RemovePayload = {
  target: TemplateValue;
};

function parseRemovePayload(rawStep: CommandStepRaw, context: PluginParseContext): RemovePayload {
  return {
    target: assertTemplateValue(rawStep.target, "target", context),
  };
}

async function executeRemovePayload(
  payload: RemovePayload,
  context: PluginExecuteContext,
): Promise<PluginExecutionResult> {
  const targetPath = path.resolve(context.cwd, renderTemplateValue(payload.target, context.variables));
  let targetType: "file" | "directory" | undefined;
  try {
    const targetStat = await stat(targetPath);
    targetType = targetStat.isDirectory() ? "directory" : "file";
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code !== "ENOENT") {
      throw error;
    }
  }

  await rm(targetPath, { recursive: true, force: true });

  if (!targetType) {
    return {
      messages: [`Delete skipped (not found): ${toRelativeLogPath(context.cwd, targetPath)}`],
    };
  }

  return {
    messages: [`Deleted ${targetType}: ${toRelativeLogPath(context.cwd, targetPath)}`],
  };
}

export const removePlugin: CommandPlugin = {
  type: "remove",
  parse(rawStep, context) {
    return parseRemovePayload(rawStep, context);
  },
  async execute(payload, context) {
    return await executeRemovePayload(payload as RemovePayload, context);
  },
};
