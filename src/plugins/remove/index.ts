import { rm } from "node:fs/promises";
import path from "node:path";
import type { CommandPlugin, CommandStepRaw, PluginExecuteContext, PluginParseContext } from "../../types";
import { assertTemplateValue, renderTemplateValue, type TemplateValue } from "../../shared/template";

type RemovePayload = {
  target: TemplateValue;
};

function parseRemovePayload(rawStep: CommandStepRaw, context: PluginParseContext): RemovePayload {
  return {
    target: assertTemplateValue(rawStep.target, "target", context),
  };
}

async function executeRemovePayload(payload: RemovePayload, context: PluginExecuteContext): Promise<void> {
  const targetPath = path.resolve(context.cwd, renderTemplateValue(payload.target, context.variables));
  await rm(targetPath, { recursive: true, force: true });
}

export const removePlugin: CommandPlugin = {
  type: "remove",
  parse(rawStep, context) {
    return parseRemovePayload(rawStep, context);
  },
  async execute(payload, context) {
    await executeRemovePayload(payload as RemovePayload, context);
  },
};
