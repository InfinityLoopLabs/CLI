import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isDeepStrictEqual, promisify } from "node:util";
import type {
  CommandPlugin,
  CommandStepRaw,
  PluginExecuteContext,
  PluginExecutionResult,
  PluginParseContext,
} from "../../types";
import { assertTemplateValue, renderTemplateValue, type TemplateValue } from "../../shared/template";

const execFileAsync = promisify(execFile);

type ExecFileError = Error & {
  code?: number | string;
  stderr?: string | Buffer;
};

type MergeTemplatePayload = {
  repo: string;
  ref: string;
  protectedPaths: TemplateValue[];
};

const TEMPLATE_REFS_PREFIX = "refs/infinityloop/templates";

type TemplateRefs = {
  currentRef: string;
  nextRef: string;
};

type TemplateOperation =
  | { type: "A" | "M" | "D"; path: string }
  | { type: "R"; oldPath: string; newPath: string; score: string };

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

  return {
    repo: rawStep.repo,
    ref: (rawStep.ref as string | undefined) ?? "main",
    protectedPaths: parseProtectedPaths(rawStep.protectedPaths, context),
  };
}

function createTemplateKey(repo: string, ref: string): string {
  return createHash("sha1").update(`${repo}::${ref}`).digest("hex");
}

function buildTemplateRefs(templateKey: string): TemplateRefs {
  return {
    currentRef: `${TEMPLATE_REFS_PREFIX}/${templateKey}/current`,
    nextRef: `${TEMPLATE_REFS_PREFIX}/${templateKey}/next`,
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

async function resolveGitRef(ref: string, cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--verify", "-q", ref], { cwd });
    const resolved = stdout.trim();
    return resolved || undefined;
  } catch (error) {
    const execError = error as ExecFileError;
    if (execError.code === 1 || execError.code === 128) {
      return undefined;
    }
    throw error;
  }
}

async function commitExists(commit: string, cwd: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["cat-file", "-e", `${commit}^{commit}`], { cwd });
    return true;
  } catch (error) {
    const execError = error as ExecFileError;
    if (execError.code === 128) {
      return false;
    }
    throw error;
  }
}

async function setGitRef(ref: string, commit: string, cwd: string): Promise<void> {
  await runGit(["update-ref", ref, commit], cwd);
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

function buildPathspecArgs(protectedPaths: string[]): string[] {
  if (protectedPaths.length === 0) {
    return [];
  }

  return ["--", ".", ...protectedPaths.map(entry => `:(exclude)${normalizePathForCompare(entry)}`)];
}

function buildDiffArgs(protectedPaths: string[], baseRef: string, targetRef: string): string[] {
  const diffArgs = ["diff", "--binary", baseRef, targetRef];
  return [...diffArgs, ...buildPathspecArgs(protectedPaths)];
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

async function collectTemplateDeletions(
  cwd: string,
  protectedPaths: string[],
  baseRef: string,
  targetRef: string,
): Promise<string[]> {
  const { stdout } = await runGit(
    ["diff", "--name-only", "--diff-filter=D", baseRef, targetRef, ...buildPathspecArgs(protectedPaths)],
    cwd,
  );
  return stdout
    .split("\n")
    .map(entry => entry.trim())
    .filter(Boolean);
}

async function collectTemplateOperations(params: {
  cwd: string;
  protectedPaths: string[];
  baseRef: string;
  targetRef: string;
}): Promise<TemplateOperation[]> {
  const { stdout } = await runGit(
    ["diff", "--name-status", "-M", "-C", params.baseRef, params.targetRef, ...buildPathspecArgs(params.protectedPaths)],
    params.cwd,
  );

  return stdout
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map<TemplateOperation | undefined>(line => {
      const fields = line.split("\t");
      const status = fields[0];
      if (!status) {
        return undefined;
      }
      if (status === "A" || status === "M" || status === "D") {
        const filePath = fields[1];
        if (!filePath) {
          return undefined;
        }
        return { type: status, path: normalizePathForCompare(filePath) };
      }
      if (status.startsWith("R")) {
        const oldPath = fields[1];
        const newPath = fields[2];
        if (!oldPath || !newPath) {
          return undefined;
        }
        return {
          type: "R",
          score: status.slice(1),
          oldPath: normalizePathForCompare(oldPath),
          newPath: normalizePathForCompare(newPath),
        };
      }
      return undefined;
    })
    .filter((item): item is TemplateOperation => Boolean(item));
}

async function isFileTrackedInTemplateHistory(filePath: string, cwd: string, baseRef: string): Promise<boolean> {
  const normalized = filePath.replace(/\\/g, "/");
  try {
    await execFileAsync("git", ["cat-file", "-e", `${baseRef}:${normalized}`], { cwd });
    return true;
  } catch {
    return false;
  }
}

async function filterTemplateOwnedDeletions(files: string[], cwd: string, baseRef: string): Promise<string[]> {
  const owned: string[] = [];
  for (const file of files) {
    if (await isFileTrackedInTemplateHistory(file, cwd, baseRef)) {
      owned.push(file);
    }
  }
  return owned;
}

function extractGitApplyConflictPaths(stderr: string): string[] {
  const paths = new Set<string>();
  stderr
    .split(/\r?\n/)
    .map(line => line.trim())
    .forEach(line => {
      const match = /^error: (.+?)(?::|$)/.exec(line);
      if (match) {
        const candidate = (match[1] ?? "").trim();
        if (candidate && !candidate.startsWith("patch")) {
          paths.add(candidate);
        }
      }
    });
  return Array.from(paths);
}

async function resetConflictingFilesToHead(files: string[], cwd: string): Promise<void> {
  for (const file of files) {
    await execFileAsync("git", ["checkout", "--", file], { cwd }).catch(() => undefined);
  }
}

type WorkingTreeSnapshot = {
  exists: boolean;
  content?: string;
};

const JSON_MISSING = Symbol("json-missing");

async function readWorkingTreeSnapshot(filePath: string, cwd: string): Promise<WorkingTreeSnapshot> {
  const absolutePath = path.resolve(cwd, filePath);
  try {
    return {
      exists: true,
      content: await readFile(absolutePath, "utf8"),
    };
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      return { exists: false };
    }
    throw error;
  }
}

async function captureWorkingTreeSnapshots(files: string[], cwd: string): Promise<Map<string, WorkingTreeSnapshot>> {
  const snapshots = new Map<string, WorkingTreeSnapshot>();
  for (const file of files) {
    snapshots.set(file, await readWorkingTreeSnapshot(file, cwd));
  }
  return snapshots;
}

async function readGitRevisionFile(ref: string, filePath: string, cwd: string): Promise<string | undefined> {
  const normalizedPath = normalizePathForCompare(filePath);
  try {
    const { stdout } = await execFileAsync("git", ["show", `${ref}:${normalizedPath}`], {
      cwd,
      encoding: "utf8",
    });
    return stdout;
  } catch (error) {
    const execError = error as ExecFileError;
    if (execError.code === 128) {
      return undefined;
    }
    throw error;
  }
}

function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeJsonValues(
  base: unknown,
  current: unknown,
  local: unknown,
): unknown {
  if (isDeepStrictEqual(current, local)) {
    return current;
  }

  if (isDeepStrictEqual(current, base)) {
    return local === JSON_MISSING ? undefined : local;
  }

  if (isDeepStrictEqual(local, base)) {
    return current === JSON_MISSING ? undefined : current;
  }

  if (isPlainJsonObject(base) || isPlainJsonObject(current) || isPlainJsonObject(local)) {
    const baseRecord = isPlainJsonObject(base) ? base : {};
    const currentRecord = isPlainJsonObject(current) ? current : {};
    const localRecord = isPlainJsonObject(local) ? local : {};
    const merged: Record<string, unknown> = {};
    const keys = new Set([
      ...Object.keys(baseRecord),
      ...Object.keys(currentRecord),
      ...Object.keys(localRecord),
    ]);

    for (const key of keys) {
      const nextValue = mergeJsonValues(
        key in baseRecord ? baseRecord[key] : JSON_MISSING,
        key in currentRecord ? currentRecord[key] : JSON_MISSING,
        key in localRecord ? localRecord[key] : JSON_MISSING,
      );

      if (nextValue !== undefined && nextValue !== JSON_MISSING) {
        merged[key] = nextValue;
      }
    }

    return merged;
  }

  return local === JSON_MISSING ? undefined : local;
}

function tryMergeJsonVersions(params: {
  filePath: string;
  current: string | undefined;
  base: string | undefined;
  local: string | undefined;
}): string | undefined {
  if (!params.filePath.endsWith(".json")) {
    return undefined;
  }

  try {
    const current = params.current === undefined ? JSON_MISSING : JSON.parse(params.current);
    const base = params.base === undefined ? JSON_MISSING : JSON.parse(params.base);
    const local = params.local === undefined ? JSON_MISSING : JSON.parse(params.local);
    const merged = mergeJsonValues(base, current, local);

    if (merged === undefined || merged === JSON_MISSING) {
      return "";
    }

    return `${JSON.stringify(merged, null, 2)}\n`;
  } catch {
    return undefined;
  }
}

async function mergeFileVersions(params: {
  filePath: string;
  cwd: string;
  current: string | undefined;
  base: string | undefined;
  local: string | undefined;
}): Promise<string> {
  const jsonMerged = tryMergeJsonVersions(params);
  if (jsonMerged !== undefined) {
    return jsonMerged;
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ill-conflict-"));
  const currentPath = path.join(tempDir, "current");
  const basePath = path.join(tempDir, "base");
  const localPath = path.join(tempDir, "local");

  try {
    await writeFile(currentPath, params.current ?? "", "utf8");
    await writeFile(basePath, params.base ?? "", "utf8");
    await writeFile(localPath, params.local ?? "", "utf8");

    try {
      await execFileAsync("git", ["merge-file", currentPath, basePath, localPath], { cwd: params.cwd });
    } catch (error) {
      const execError = error as ExecFileError;
      if (execError.code !== 1) {
        throw error;
      }
    }

    return await readFile(currentPath, "utf8");
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function restoreConflictingFiles(params: {
  files: string[];
  cwd: string;
  snapshots: Map<string, WorkingTreeSnapshot>;
}): Promise<void> {
  for (const file of params.files) {
    const snapshot = params.snapshots.get(file);
    if (!snapshot) {
      continue;
    }

    const current = await readWorkingTreeSnapshot(file, params.cwd);
    const base = await readGitRevisionFile("HEAD", file, params.cwd);
    const merged = await mergeFileVersions({
      filePath: file,
      cwd: params.cwd,
      current: current.exists ? current.content : undefined,
      base,
      local: snapshot.exists ? snapshot.content : undefined,
    });

    const absolutePath = path.resolve(params.cwd, file);
    if (merged.length === 0 && !current.exists && !snapshot.exists) {
      await unlink(absolutePath).catch(() => undefined);
      continue;
    }

    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, merged, "utf8");
  }
}

function getExecErrorMessage(error: unknown): string {
  const execError = error as ExecFileError;
  const rawStderr = execError.stderr
    ? typeof execError.stderr === "string"
      ? execError.stderr
      : execError.stderr.toString("utf8")
    : "";

  return rawStderr.trim() ? rawStderr.trim() : execError.message;
}

async function applyPatch(patch: string, cwd: string, autoResolved = false): Promise<void> {
  if (!patch.trim()) {
    return;
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ill-patch-"));
  const patchFile = path.join(tempDir, "template.patch");
  await writeFile(patchFile, patch, "utf8");

  try {
    await execFileAsync("git", ["apply", "--check", "--3way", "--whitespace=nowarn", patchFile], { cwd });
  } catch (error) {
    const rawStderr = getExecErrorMessage(error);
    const conflictPaths = extractGitApplyConflictPaths(rawStderr);
    if (!autoResolved && conflictPaths.length > 0) {
      const localSnapshots = await captureWorkingTreeSnapshots(conflictPaths, cwd);
      await resetConflictingFilesToHead(conflictPaths, cwd);
      await applyPatch(patch, cwd, true);
      await restoreConflictingFiles({
        files: conflictPaths,
        cwd,
        snapshots: localSnapshots,
      });
      return;
    }

    throw new Error(
      [
        "git apply failed. Resolve conflicts manually and rerun the command.",
        "Tips:",
        " - Run `git status` to see conflicted files (look for both staged and unstaged changes).",
        " - Use `git diff`/`git checkout -- <file>` to inspect or revert specific files.",
        " - Commit or stash your local changes before running `ill sync` again.",
      ].join("\n"),
      { cause: new Error(rawStderr) },
    );
  }

  try {
    await execFileAsync("git", ["apply", "--3way", "--whitespace=nowarn", patchFile], { cwd });
  } catch (error) {
    throw new Error("git apply failed after pre-check passed.", { cause: new Error(getExecErrorMessage(error)) });
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

type PatchCheckResult = {
  patch?: string;
  deletedFiles: string[];
  mode: "template-history" | "legacy-head";
  deletionOwnershipBaseRef?: string;
};

async function previewPatch(params: {
  payload: MergeTemplatePayload;
  cwd: string;
  protectedPaths: string[];
  targetRef: string;
  templateBaseRef?: string;
}): Promise<PatchCheckResult> {
  const baseRef = params.templateBaseRef ?? "HEAD";
  const deletionOwnershipBaseRef = params.templateBaseRef ?? `${params.targetRef}^`;
  const diffArgs = buildDiffArgs(params.protectedPaths, baseRef, params.targetRef);
  const { stdout: patch } = await runGit(diffArgs, params.cwd);
  if (!patch.trim()) {
    return {
      deletedFiles: [],
      mode: params.templateBaseRef ? "template-history" : "legacy-head",
      deletionOwnershipBaseRef,
    };
  }

  const deletedFiles = await collectTemplateDeletions(params.cwd, params.protectedPaths, baseRef, params.targetRef);
  return {
    patch,
    deletedFiles,
    mode: params.templateBaseRef ? "template-history" : "legacy-head",
    deletionOwnershipBaseRef,
  };
}

type DeletionDecision = {
  proceed: boolean;
  keep: Set<string>;
};

type SelectionResult = {
  action: "continue" | "keep-all" | "abort";
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
    return { action: "continue", deletes: new Set() };
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

    const finalize = (action: SelectionResult["action"]) => {
      if (finished) {
        return;
      }
      finished = true;
      cleanup();
      resolve({ action, deletes });
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
        finalize(chunk === "\u001b" ? "keep-all" : "abort");
        return;
      }

      if (chunk === "\r" || chunk === "\n") {
        finalize("continue");
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
  if (selection.action === "abort") {
    return { proceed: false, keep: new Set() };
  }
  if (selection.action === "keep-all") {
    return { proceed: true, keep: new Set(files) };
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
        resolve({ proceed: true, keep: new Set(files) });
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

  const diffRegex = /^diff --git a\/(.+?) b\/.*(?:\r?\n[\s\S]*?)?(?=^diff --git |\u0000|(?![\s\S]))/gm;
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

async function resolveTemplateBaseCommit(cwd: string, refs: TemplateRefs): Promise<string | undefined> {
  const fromRef = await resolveGitRef(refs.currentRef, cwd);
  if (fromRef && (await commitExists(fromRef, cwd))) {
    return fromRef;
  }
  return undefined;
}

function resolveDryRunFlag(variables: Record<string, string | undefined>): boolean {
  const raw = (variables.dryRun ?? variables.plan ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

async function executeMergeTemplatePayload(
  payload: MergeTemplatePayload,
  context: PluginExecuteContext,
): Promise<PluginExecutionResult> {
  await ensureGitRepository(context.cwd);
  await ensureNoMergeInProgress(context.cwd);

  const repo = normalizeRepoSource(resolveVariables(payload.repo, context.variables));
  const ref = resolveVariables(payload.ref, context.variables);
  const dryRun = resolveDryRunFlag(context.variables);
  const templateKey = createTemplateKey(repo, ref);
  const refs = buildTemplateRefs(templateKey);
  const remoteName = `ill-template-${Date.now()}`;
  const protectedPathsRaw = payload.protectedPaths.map(value => renderTemplateValue(value, context.variables));
  const protectedPaths = normalizeProtectedPaths(protectedPathsRaw, context.cwd).map(normalizePathForCompare);

  try {
    await runGit(["remote", "add", remoteName, repo], context.cwd);
    await runGit(["fetch", "--depth", "20", remoteName, ref], context.cwd);
    const fetchedCommit = await resolveGitRef("FETCH_HEAD", context.cwd);
    if (!fetchedCommit) {
      throw new Error(`Unable to resolve fetched template commit for "${repo}" ref "${ref}".`);
    }
    await setGitRef(refs.nextRef, fetchedCommit, context.cwd);

    const templateBaseCommit = await resolveTemplateBaseCommit(context.cwd, refs);
    const baseRefForDiff = templateBaseCommit ?? "HEAD";
    const operations = await collectTemplateOperations({
      cwd: context.cwd,
      protectedPaths,
      baseRef: baseRefForDiff,
      targetRef: refs.nextRef,
    });

    const { patch, deletedFiles, mode, deletionOwnershipBaseRef } = await previewPatch({
      payload,
      cwd: context.cwd,
      protectedPaths,
      targetRef: refs.nextRef,
      templateBaseRef: templateBaseCommit,
    });

    const keepFiles = new Set<string>();
    const pendingDeletions = deletedFiles;
    const templateOwnedDeletions =
      mode === "template-history"
        ? pendingDeletions
        : deletionOwnershipBaseRef
          ? await filterTemplateOwnedDeletions(pendingDeletions, context.cwd, deletionOwnershipBaseRef)
          : [];
    const templateOwnedDeletionSet = new Set(templateOwnedDeletions);
    const nonTemplateOwnedDeletions = pendingDeletions.filter(file => !templateOwnedDeletionSet.has(file));
    nonTemplateOwnedDeletions.forEach(file => keepFiles.add(file));

    if (dryRun) {
      return {
        messages: [
          `Plan mode: ${operations.length} operation(s)`,
          `Template-owned deletions: ${templateOwnedDeletions.length}`,
          `Product-only deletions ignored: ${nonTemplateOwnedDeletions.length}`,
        ],
      };
    }

    let nextPatch = patch;
    if (nextPatch && keepFiles.size > 0) {
      nextPatch = removeKeptDeletionsFromPatch(nextPatch, keepFiles);
    }

    if (nextPatch && nextPatch.trim()) {
      await applyPatch(nextPatch, context.cwd);
    }

    await setGitRef(refs.currentRef, fetchedCommit, context.cwd);
    return {
      messages: [
        `Template sync applied: ${operations.length} operation(s)`,
        `Template-owned deletions applied: ${templateOwnedDeletions.length}`,
        `Product-only deletions ignored: ${nonTemplateOwnedDeletions.length}`,
      ],
    };
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
    return await executeMergeTemplatePayload(payload as MergeTemplatePayload, context);
  },
};
