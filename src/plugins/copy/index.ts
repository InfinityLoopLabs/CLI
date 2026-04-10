import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
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

type CopyPayload = {
  from: TemplateValue;
  to: TemplateValue;
};

type FileCopyResult = {
  targetFilePath: string;
  created: boolean;
};

function parseCopyPayload(rawStep: CommandStepRaw, context: PluginParseContext): CopyPayload {
  return {
    from: assertTemplateValue(rawStep.from, "from", context),
    to: assertTemplateValue(rawStep.to, "to", context),
  };
}

async function copyFile(sourceFilePath: string, targetFilePath: string): Promise<FileCopyResult> {
  const created = !existsSync(targetFilePath);
  await mkdir(path.dirname(targetFilePath), { recursive: true });
  const buffer = await readFile(sourceFilePath);
  await writeFile(targetFilePath, buffer);
  return {
    targetFilePath,
    created,
  };
}

async function copyDir(sourceDir: string, targetDir: string): Promise<FileCopyResult[]> {
  const copiedFiles: FileCopyResult[] = [];
  await mkdir(targetDir, { recursive: true });
  const entries = await readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      const nested = await copyDir(sourcePath, targetPath);
      copiedFiles.push(...nested);
      continue;
    }

    if (entry.isFile()) {
      copiedFiles.push(await copyFile(sourcePath, targetPath));
    }
  }

  return copiedFiles;
}

async function executeCopyPayload(payload: CopyPayload, context: PluginExecuteContext): Promise<PluginExecutionResult> {
  const sourcePath = path.resolve(context.cwd, renderTemplateValue(payload.from, context.variables));
  const targetPath = path.resolve(context.cwd, renderTemplateValue(payload.to, context.variables));
  if (!existsSync(sourcePath)) {
    throw new Error(`Copy source path does not exist: ${sourcePath}`);
  }

  const sourceStats = await stat(sourcePath);
  const copiedFiles: FileCopyResult[] = [];
  if (sourceStats.isDirectory()) {
    copiedFiles.push(...(await copyDir(sourcePath, targetPath)));
  } else if (sourceStats.isFile()) {
    let targetFilePath = targetPath;
    if (existsSync(targetPath)) {
      const targetStats = await stat(targetPath);
      if (targetStats.isDirectory()) {
        targetFilePath = path.join(targetPath, path.basename(sourcePath));
      }
    }

    copiedFiles.push(await copyFile(sourcePath, targetFilePath));
  } else {
    throw new Error(`Copy source path must be a file or directory: ${sourcePath}`);
  }

  const messages = compactMessages(
    copiedFiles.map((entry) => {
      const status = entry.created ? "Created file" : "Updated file";
      return `${status}: ${toRelativeLogPath(context.cwd, entry.targetFilePath)}`;
    }),
  );
  return { messages };
}

export const copyPlugin: CommandPlugin = {
  type: "copy",
  parse(rawStep, context) {
    return parseCopyPayload(rawStep, context);
  },
  async execute(payload, context) {
    return await executeCopyPayload(payload as CopyPayload, context);
  },
};
