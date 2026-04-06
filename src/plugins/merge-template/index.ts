import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { CommandPlugin, CommandStepRaw, PluginExecuteContext, PluginParseContext } from "../../types";
import { assertTemplateValue, renderTemplateValue, type TemplateValue } from "../../shared/template";

const execFileAsync = promisify(execFile);

type ExecFileError = Error & {
  code?: number | string;
  stderr?: string | Buffer;
};

type MergeTemplatePayload = {
  repo: string;
  ref: string;
  allowDeletes: boolean;
  protectedPaths: TemplateValue[];
};

function parseProtectedPaths(rawValue: unknown, context: PluginParseContext): TemplateValue[] {
  if (rawValue === undefined) {
    return [];
  }

  if (!Array.isArray(rawValue)) {
    throw new Error(
      `Config "${context.configPath}" commands["${context.commandKey}"][${context.stepIndex}] type "merge-template" field "protectedPaths" must be an array.`,
    );
  }

  return rawValue.map((entry, index) => assertTemplateValue(entry, `protectedPaths[${index}]`, context));
}

function parseMergeTemplatePayload(rawStep: CommandStepRaw, context: PluginParseContext): MergeTemplatePayload {
  if (typeof rawStep.repo !== "string") {
    throw new Error(
      `Config "${context.configPath}" commands["${context.commandKey}"][${context.stepIndex}] type "merge-template" requires string field "repo".`,
    );
  }

  if (rawStep.ref !== undefined && typeof rawStep.ref !== "string") {
    throw new Error(
      `Config "${context.configPath}" commands["${context.commandKey}"][${context.stepIndex}] type "merge-template" field "ref" must be a string.`,
    );
  }

  if (rawStep.allowDeletes !== undefined && typeof rawStep.allowDeletes !== "boolean") {
    throw new Error(
      `Config "${context.configPath}" commands["${context.commandKey}"][${context.stepIndex}] type "merge-template" field "allowDeletes" must be boolean.`,
    );
  }

  return {
    repo: rawStep.repo,
    ref: (rawStep.ref as string | undefined) ?? "main",
    allowDeletes: (rawStep.allowDeletes as boolean | undefined) ?? true,
    protectedPaths: parseProtectedPaths(rawStep.protectedPaths, context),
  };
}

function resolveVariables(value: string, variables: Record<string, string | undefined>): string {
  return value.replace(/\$([A-Za-z_]\w*)/g, (_, variableName: string) => {
    const resolved = variables[variableName];
    if (!resolved) {
      throw new Error(`Variable "$${variableName}" is required but was not provided.`);
    }
    return resolved;
  });
}

function isGithubShorthand(repo: string): boolean {
  if (
    repo.includes("://") ||
    repo.startsWith("git@") ||
    repo.startsWith(".") ||
    repo.startsWith("/") ||
    repo.startsWith("~") ||
    repo.includes("\\") ||
    repo.endsWith(".git")
  ) {
    return false;
  }

  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo);
}

function normalizeRepoSource(repo: string): string {
  if (isGithubShorthand(repo)) {
    return `https://github.com/${repo}.git`;
  }
  return repo;
}

async function runGit(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync("git", args, { cwd });
    return { stdout, stderr };
  } catch (error) {
    const execError = error as ExecFileError;
    const stderr = execError.stderr
      ? typeof execError.stderr === "string"
        ? execError.stderr
        : execError.stderr.toString("utf8")
      : "";
    const suffix = stderr.trim();
    const details = suffix ? `${execError.message}: ${suffix}` : execError.message;
    throw new Error(`Git command failed: git ${args.join(" ")}. ${details}`);
  }
}

async function ensureGitRepository(cwd: string): Promise<void> {
  const { stdout } = await runGit(["rev-parse", "--is-inside-work-tree"], cwd);
  if (stdout.trim() !== "true") {
    throw new Error(`Current directory is not a git repository: ${cwd}`);
  }
}

async function hasMergeInProgress(cwd: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["rev-parse", "-q", "--verify", "MERGE_HEAD"], { cwd });
    return true;
  } catch (error) {
    const execError = error as ExecFileError;
    if (execError.code === 1) {
      return false;
    }
    const stderr = execError.stderr
      ? typeof execError.stderr === "string"
        ? execError.stderr
        : execError.stderr.toString("utf8")
      : "";
    const suffix = stderr.trim();
    const details = suffix ? `${execError.message}: ${suffix}` : execError.message;
    throw new Error(`Git command failed: git rev-parse -q --verify MERGE_HEAD. ${details}`);
  }
}

async function ensureNoMergeInProgress(cwd: string): Promise<void> {
  if (await hasMergeInProgress(cwd)) {
    throw new Error(
      'Unfinished merge detected (MERGE_HEAD exists). Resolve conflicts (git add/commit) or run "git merge --abort" first.',
    );
  }
}

function buildDiffArgs(payload: MergeTemplatePayload): string[] {
  const diffArgs = ["diff", "--binary", "HEAD", "FETCH_HEAD"];
  if (!payload.allowDeletes) {
    diffArgs.splice(1, 0, "--diff-filter=AMRTUXB");
  }
  return diffArgs;
}

function normalizeProtectedPaths(paths: string[], cwd: string): string[] {
  const normalized: string[] = [];
  const cwdWithSep = cwd.endsWith(path.sep) ? cwd : `${cwd}${path.sep}`;

  for (const raw of paths) {
    const trimmed = raw.trim();
    if (!trimmed) {
      continue;
    }
    const relativePath = path.normalize(trimmed).replace(/^([./\\])+/g, "");
    if (!relativePath || relativePath === ".") {
      continue;
    }
    const resolved = path.resolve(cwd, relativePath);
    if (resolved !== cwd && !resolved.startsWith(cwdWithSep)) {
      throw new Error(`Protected path "${raw}" resolves outside of project root.`);
    }
    normalized.push(path.relative(cwd, resolved));
  }

  return Array.from(new Set(normalized));
}

function normalizePathForCompare(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\/+/g, "");
}

function isProtectedFile(filePath: string, protectedPaths: string[]): boolean {
  if (protectedPaths.length === 0) {
    return false;
  }

  const normalizedFile = normalizePathForCompare(filePath);
  return protectedPaths.some(entry => {
    const normalizedEntry = normalizePathForCompare(entry);
    if (!normalizedEntry) {
      return false;
    }
    return normalizedFile === normalizedEntry || normalizedFile.startsWith(`${normalizedEntry}/`);
  });
}

function formatFileList(files: string[]): string {
  return files.map(file => ` - ${file}`).join("\n");
}

async function collectTemplateDeletions(cwd: string): Promise<string[]> {
  const { stdout } = await runGit(["diff", "--name-only", "--diff-filter=D", "HEAD", "FETCH_HEAD"], cwd);
  return stdout
    .split("\n")
    .map(entry => entry.trim())
    .filter(Boolean);
}

async function isFileTrackedInTemplateHistory(filePath: string, cwd: string): Promise<boolean> {
  const normalized = filePath.replace(/\\/g, "/");
  try {
    await execFileAsync("git", ["cat-file", "-e", `FETCH_HEAD^:${normalized}`], { cwd });
    return true;
  } catch {
    return false;
  }
}

async function filterTemplateOwnedDeletions(files: string[], cwd: string): Promise<string[]> {
  const owned: string[] = [];
  for (const file of files) {
    if (await isFileTrackedInTemplateHistory(file, cwd)) {
      owned.push(file);
    }
  }
  return owned;
}

async function applyPatch(patch: string, cwd: string): Promise<void> {
  if (!patch.trim()) {
    return;
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ill-patch-"));
  const patchFile = path.join(tempDir, "template.patch");
  await writeFile(patchFile, patch, "utf8");

  try {
    await execFileAsync("git", ["apply", "--3way", "--whitespace=nowarn", patchFile], { cwd });
  } catch (error) {
    const execError = error as ExecFileError;
    const stderr = execError.stderr
      ? typeof execError.stderr === "string"
        ? execError.stderr
        : execError.stderr.toString("utf8")
      : "";
    const suffix = stderr.trim();
    throw new Error(
      suffix
        ? `git apply failed. ${suffix}`
        : "git apply failed. Resolve conflicts in the working tree and re-run the command.",
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

type PatchCheckResult = {
  patch?: string;
  deletedFiles: string[];
};

async function previewPatch(payload: MergeTemplatePayload, cwd: string): Promise<PatchCheckResult> {
  const diffArgs = buildDiffArgs(payload);
  const { stdout: patch } = await runGit(diffArgs, cwd);
  if (!patch.trim()) {
    return { deletedFiles: [] };
  }

  const deletedFiles = await collectTemplateDeletions(cwd);
  return { patch, deletedFiles };
}

type DeletionDecision = {
  proceed: boolean;
  keep: Set<string>;
};

type SelectionResult = {
  cancelled: boolean;
  deletes: Set<string>;
};

function canPromptForDeletes(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function hideCursor(): void {
  process.stdout.write("\x1B[?25l");
}

function showCursor(): void {
  process.stdout.write("\x1B[?25h");
}

async function runInteractiveSelection(files: string[]): Promise<SelectionResult> {
  if (files.length === 0) {
    return { cancelled: false, deletes: new Set() };
  }

  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    const deletes = new Set<string>(files);
    let cursor = 0;
    let renderedLines = 0;
    let finished = false;

    const instructions = "Use ↑/↓ or W/S to move, Space toggles delete (x = delete), Enter to continue, q to cancel.";

    const cleanup = () => {
      stdin.removeListener("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      showCursor();
      stdout.write("\n");
    };

    const render = () => {
      const lines: string[] = [instructions, "", ...files.map((file, index) => {
        const pointer = cursor === index ? ">" : " ";
        const mark = deletes.has(file) ? "x" : " ";
        return `${pointer} [${mark}] ${file}`;
      })];

      if (renderedLines > 0) {
        stdout.write(`\x1B[${renderedLines}A`);
        stdout.write("\x1B[0J");
      }

      stdout.write(lines.join("\n"));
      stdout.write("\n");
      renderedLines = lines.length;
    };

    const finalize = (cancelled: boolean) => {
      if (finished) {
        return;
      }
      finished = true;
      cleanup();
      resolve({ cancelled, deletes });
    };

    const moveUp = () => {
      cursor = cursor === 0 ? files.length - 1 : cursor - 1;
      render();
    };

    const moveDown = () => {
      cursor = cursor === files.length - 1 ? 0 : cursor + 1;
      render();
    };

    const onData = (chunk: string) => {
      if (chunk === "\u0003") {
        cleanup();
        reject(new Error("Interrupted"));
        return;
      }

      if (chunk === "\u001b[A" || chunk === "w" || chunk === "W") {
        moveUp();
        return;
      }

      if (chunk === "\u001b[B" || chunk === "s" || chunk === "S") {
        moveDown();
        return;
      }

      if (chunk === " ") {
        const file = files[cursor];
        if (file) {
          if (deletes.has(file)) {
            deletes.delete(file);
          } else {
            deletes.add(file);
          }
          render();
        }
        return;
      }

      if (chunk === "q" || chunk === "Q" || chunk === "\u001b") {
        finalize(true);
        return;
      }

      if (chunk === "\r" || chunk === "\n") {
        finalize(false);
      }
    };

    stdin.setEncoding("utf8");
    stdin.setRawMode(true);
    stdin.resume();
    hideCursor();
    render();
    stdin.on("data", onData);
  });
}

async function confirmTemplateDeletions(files: string[]): Promise<DeletionDecision> {
  if (!canPromptForDeletes()) {
    return { proceed: true, keep: new Set() };
  }

  const selection = await runInteractiveSelection(files);
  if (selection.cancelled) {
    return { proceed: false, keep: new Set() };
  }
  const keep = new Set<string>();
  for (const file of files) {
    if (!selection.deletes.has(file)) {
      keep.add(file);
    }
  }

  const stdin = process.stdin;
  const stdout = process.stdout;

  stdout.write(`Delete ${selection.deletes.size} file(s)? Press y to confirm, n or Esc to cancel. `);

  return new Promise(resolve => {
    const onData = (chunk: string) => {
      stdin.removeListener("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      showCursor();
      stdout.write("\n");

      if (chunk === "y" || chunk === "Y") {
        resolve({ proceed: true, keep });
      } else {
        resolve({ proceed: false, keep: new Set() });
      }
    };

    stdin.setEncoding("utf8");
    stdin.setRawMode(true);
    stdin.resume();
    hideCursor();
    stdin.on("data", rawChunk => {
      const chunk = typeof rawChunk === "string" ? rawChunk : rawChunk.toString("utf8");
      if (chunk === "y" || chunk === "Y") {
        onData(chunk);
      } else if (chunk === "n" || chunk === "N" || chunk === "\u001b") {
        onData(chunk);
      }
    });
  });
}

function removeKeptDeletionsFromPatch(patch: string, keep: Set<string>): string {
  if (keep.size === 0) {
    return patch;
  }

  const diffRegex = /^diff --git a\/(.+?) b\/.*\n[\s\S]*?(?=^diff --git |\u0000|\Z)/gm;
  let result = "";
  let lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = diffRegex.exec(patch)) !== null) {
    const start = match.index;
    const end = diffRegex.lastIndex;
    const block = patch.slice(start, end);
    const filePath = match[1];

    result += patch.slice(lastIndex, start);
    if (!filePath || !keep.has(filePath)) {
      result += block;
    }
    lastIndex = end;
  }

  result += patch.slice(lastIndex);
  return result;
}

async function executeMergeTemplatePayload(
  payload: MergeTemplatePayload,
  context: PluginExecuteContext,
): Promise<void> {
  await ensureGitRepository(context.cwd);
  await ensureNoMergeInProgress(context.cwd);

  const repo = normalizeRepoSource(resolveVariables(payload.repo, context.variables));
  const ref = resolveVariables(payload.ref, context.variables);
  const remoteName = `ill-template-${Date.now()}`;

  try {
    await runGit(["remote", "add", remoteName, repo], context.cwd);
    await runGit(["fetch", "--depth", "20", remoteName, ref], context.cwd);

    const { patch, deletedFiles } = await previewPatch(payload, context.cwd);
    if (!patch) {
      return;
    }
    let nextPatch = patch;

    const pendingDeletions = deletedFiles;
    const templateOwnedDeletions = await filterTemplateOwnedDeletions(deletedFiles, context.cwd);
    if (!payload.allowDeletes && templateOwnedDeletions.length > 0) {
      throw new Error(
        `Template update wants to delete these files:\n${formatFileList(templateOwnedDeletions)}\nEnable deletions by setting allowDeletes: true or move the files out of template control.`,
      );
    }

    const protectedPathsRaw = payload.protectedPaths.map(value => renderTemplateValue(value, context.variables));
    const protectedPaths = normalizeProtectedPaths(protectedPathsRaw, context.cwd).map(normalizePathForCompare);
    if (payload.allowDeletes) {
      const keep = new Set<string>(pendingDeletions.filter(file => isProtectedFile(file, protectedPaths)));
      const deletionsToConfirm = pendingDeletions.filter(file => !keep.has(file));

      if (deletionsToConfirm.length > 0) {
        const decision = await confirmTemplateDeletions(deletionsToConfirm);
        if (!decision.proceed) {
          throw new Error("Template merge cancelled by user (deletions skipped).");
        }
        for (const file of deletionsToConfirm) {
          const absolute = path.resolve(context.cwd, file);
          if (!existsSync(absolute)) {
            decision.keep.add(file);
          }
        }
        decision.keep.forEach(file => keep.add(file));
      }

      if (keep.size > 0) {
        nextPatch = removeKeptDeletionsFromPatch(nextPatch, keep);
        if (!nextPatch.trim()) {
          return;
        }
      }
    }

    await applyPatch(nextPatch, context.cwd);
  } finally {
    await execFileAsync("git", ["remote", "remove", remoteName], { cwd: context.cwd }).catch(() => undefined);
  }
}

export const mergeTemplatePlugin: CommandPlugin = {
  type: "merge-template",
  parse(rawStep, context) {
    return parseMergeTemplatePayload(rawStep, context);
  },
  async execute(payload, context) {
    await executeMergeTemplatePayload(payload as MergeTemplatePayload, context);
  },
};
