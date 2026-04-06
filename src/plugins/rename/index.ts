import { rename as renamePath } from "node:fs/promises";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CommandPlugin, CommandStepRaw, PluginExecuteContext, PluginParseContext } from "../../types";
import { isPlainObject } from "../../shared/is-plain-object";

type ReplaceRule = {
  from: string;
  to: string;
};

type RenamePayload = {
  target: string;
  replace: ReplaceRule[];
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

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const capitalize = (value: string): string =>
  value.length > 0 ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value;

function applyCaseFromMatch(match: string, replacement: string): string {
  if (match === match.toUpperCase() && /[A-Z]/.test(match)) {
    return replacement.toUpperCase();
  }
  if (match === match.toLowerCase()) {
    return replacement.toLowerCase();
  }

  const isCapitalized =
    match.charAt(0) === match.charAt(0).toUpperCase() &&
    match.slice(1) === match.slice(1).toLowerCase();

  if (isCapitalized) {
    return capitalize(replacement);
  }

  return replacement;
}

function applyReplaceRules(input: string, rules: ReplaceRule[], variables: Record<string, string | undefined>): string {
  let output = input;

  for (const rule of rules) {
    const replacement = resolveVariables(rule.to, variables);
    const pattern = new RegExp(escapeRegExp(rule.from), "gi");
    output = output.replace(pattern, (match) => applyCaseFromMatch(match, replacement));
  }

  return output;
}

function normalizeReplaceRules(rawRules: unknown, context: PluginParseContext): ReplaceRule[] {
  if (!Array.isArray(rawRules)) {
    throw new Error(
      `Config "${context.configPath}" commands["${context.commandKey}"][${context.stepIndex}] field "replace" must be an array.`,
    );
  }

  const normalized: ReplaceRule[] = [];
  for (const [ruleIndex, rule] of rawRules.entries()) {
    if (!isPlainObject(rule)) {
      throw new Error(
        `Config "${context.configPath}" commands["${context.commandKey}"][${context.stepIndex}].replace[${ruleIndex}] must be an object.`,
      );
    }

    if (typeof rule.from === "string" && typeof rule.to === "string") {
      normalized.push({ from: rule.from, to: rule.to });
      continue;
    }

    for (const [from, to] of Object.entries(rule)) {
      if (typeof to !== "string") {
        throw new Error(
          `Config "${context.configPath}" commands["${context.commandKey}"][${context.stepIndex}].replace[${ruleIndex}] values must be strings.`,
        );
      }
      normalized.push({ from, to });
    }
  }

  return normalized;
}

function parseRenamePayload(rawStep: CommandStepRaw, context: PluginParseContext): RenamePayload {
  if (typeof rawStep.target !== "string") {
    throw new Error(
      `Config "${context.configPath}" commands["${context.commandKey}"][${context.stepIndex}] type "rename" requires string field "target".`,
    );
  }

  return {
    target: rawStep.target,
    replace: normalizeReplaceRules(rawStep.replace, context),
  };
}

function isLikelyTextFile(buffer: Buffer): boolean {
  const sizeToCheck = Math.min(buffer.length, 4000);
  for (let i = 0; i < sizeToCheck; i += 1) {
    if (buffer[i] === 0) {
      return false;
    }
  }
  return true;
}

async function rewriteContent(filePath: string, payload: RenamePayload, context: PluginExecuteContext): Promise<void> {
  const buffer = await readFile(filePath);
  if (!isLikelyTextFile(buffer)) {
    return;
  }

  const next = applyReplaceRules(buffer.toString("utf8"), payload.replace, context.variables);
  await writeFile(filePath, next, "utf8");
}

async function collectPathsRecursively(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const paths: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    paths.push(entryPath);
    if (entry.isDirectory()) {
      const nested = await collectPathsRecursively(entryPath);
      paths.push(...nested);
    }
  }

  return paths;
}

async function executeRenamePayload(payload: RenamePayload, context: PluginExecuteContext): Promise<void> {
  const targetPath = path.resolve(context.cwd, resolveVariables(payload.target, context.variables));
  if (!existsSync(targetPath)) {
    throw new Error(`Rename target path does not exist: ${targetPath}`);
  }

  const targetStats = await stat(targetPath);
  if (targetStats.isFile()) {
    await rewriteContent(targetPath, payload, context);
    const nextName = applyReplaceRules(path.basename(targetPath), payload.replace, context.variables);
    if (nextName !== path.basename(targetPath)) {
      await renamePath(targetPath, path.join(path.dirname(targetPath), nextName));
    }
    return;
  }

  if (!targetStats.isDirectory()) {
    throw new Error(`Rename target path must be a file or directory: ${targetPath}`);
  }

  const allPaths = await collectPathsRecursively(targetPath);

  for (const entryPath of allPaths) {
    const entryStats = await stat(entryPath);
    if (entryStats.isFile()) {
      await rewriteContent(entryPath, payload, context);
    }
  }

  const renameCandidates = allPaths
    .sort((left, right) => right.length - left.length)
    .map((entryPath) => ({
      currentPath: entryPath,
      nextName: applyReplaceRules(path.basename(entryPath), payload.replace, context.variables),
    }))
    .filter(({ currentPath, nextName }) => nextName !== path.basename(currentPath));

  for (const candidate of renameCandidates) {
    const nextPath = path.join(path.dirname(candidate.currentPath), candidate.nextName);
    await mkdir(path.dirname(nextPath), { recursive: true });
    await renamePath(candidate.currentPath, nextPath);
  }
}

export const renamePlugin: CommandPlugin = {
  type: "rename",
  parse(rawStep, context) {
    return parseRenamePayload(rawStep, context);
  },
  async execute(payload, context) {
    await executeRenamePayload(payload as RenamePayload, context);
  },
};
