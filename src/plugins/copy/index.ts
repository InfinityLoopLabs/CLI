import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CommandPlugin, CommandStepRaw, PluginExecuteContext, PluginParseContext } from "../../types";

type CopyPayload = {
  from: string;
  to: string;
};

function resolveVariables(value: string, variables: Record<string, string | undefined>): string {
  return value.replace(/\$([A-Za-z_]\w*)/g, (_, variableName: string) => {
    const resolved = variables[variableName];
    if (!resolved) {
      throw new Error(`Variable "$${variableName}" is required but was not provided.`);
    }
    return resolved;
  });
}

function parseCopyPayload(rawStep: CommandStepRaw, context: PluginParseContext): CopyPayload {
  if (typeof rawStep.from !== "string" || typeof rawStep.to !== "string") {
    throw new Error(
      `Config "${context.configPath}" commands["${context.commandKey}"][${context.stepIndex}] type "copy" requires string fields "from" and "to".`,
    );
  }

  return {
    from: rawStep.from,
    to: rawStep.to,
  };
}

async function copyFile(sourceFilePath: string, targetFilePath: string): Promise<void> {
  await mkdir(path.dirname(targetFilePath), { recursive: true });
  const buffer = await readFile(sourceFilePath);
  await writeFile(targetFilePath, buffer);
}

async function copyDir(sourceDir: string, targetDir: string): Promise<void> {
  await mkdir(targetDir, { recursive: true });
  const entries = await readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      await copyDir(sourcePath, targetPath);
      continue;
    }

    if (entry.isFile()) {
      await copyFile(sourcePath, targetPath);
    }
  }
}

async function executeCopyPayload(payload: CopyPayload, context: PluginExecuteContext): Promise<void> {
  const sourcePath = path.resolve(context.cwd, resolveVariables(payload.from, context.variables));
  const targetPath = path.resolve(context.cwd, resolveVariables(payload.to, context.variables));
  if (!existsSync(sourcePath)) {
    throw new Error(`Copy source path does not exist: ${sourcePath}`);
  }

  const sourceStats = await stat(sourcePath);
  if (sourceStats.isDirectory()) {
    await copyDir(sourcePath, targetPath);
    return;
  }

  if (sourceStats.isFile()) {
    let targetFilePath = targetPath;
    if (existsSync(targetPath)) {
      const targetStats = await stat(targetPath);
      if (targetStats.isDirectory()) {
        targetFilePath = path.join(targetPath, path.basename(sourcePath));
      }
    }

    await copyFile(sourcePath, targetFilePath);
    return;
  }

  throw new Error(`Copy source path must be a file or directory: ${sourcePath}`);
}

export const copyPlugin: CommandPlugin = {
  type: "copy",
  parse(rawStep, context) {
    return parseCopyPayload(rawStep, context);
  },
  async execute(payload, context) {
    await executeCopyPayload(payload as CopyPayload, context);
  },
};
