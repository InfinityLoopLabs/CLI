import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { mergeTemplatePlugin } from "./index";

const execFileAsync = promisify(execFile);

async function runGit(args: string[], cwd: string): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

async function getCurrentBranch(cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd });
  return stdout.trim();
}

test("merge-template applies changes without deleting local-only files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ill-merge-diff-"));

  try {
    const templateRepo = path.join(root, "template");
    const targetRepo = path.join(root, "target");

    await mkdir(templateRepo, { recursive: true });
    await runGit(["init"], templateRepo);
    await runGit(["config", "user.name", "ILL Test"], templateRepo);
    await runGit(["config", "user.email", "ill-test@example.com"], templateRepo);
    await writeFile(path.join(templateRepo, "core.txt"), "core-v1\n", "utf8");
    await runGit(["add", "."], templateRepo);
    await runGit(["commit", "-m", "template v1"], templateRepo);
    await writeFile(path.join(templateRepo, "core.txt"), "core-v2\n", "utf8");
    await runGit(["add", "core.txt"], templateRepo);
    await runGit(["commit", "-m", "template v2"], templateRepo);
    const templateBranch = await getCurrentBranch(templateRepo);

    await mkdir(targetRepo, { recursive: true });
    await writeFile(path.join(targetRepo, "core.txt"), "core-v1\n", "utf8");
    await writeFile(path.join(targetRepo, "local.txt"), "keep me\n", "utf8");
    await runGit(["init"], targetRepo);
    await runGit(["config", "user.name", "ILL Test"], targetRepo);
    await runGit(["config", "user.email", "ill-test@example.com"], targetRepo);
    await runGit(["add", "."], targetRepo);
    await runGit(["commit", "-m", "target v1"], targetRepo);

    const payload = mergeTemplatePlugin.parse(
      {
        type: "merge-template",
        repo: templateRepo,
        ref: templateBranch,
        allowDeletes: false,
        protectedPaths: [],
      },
      {
        configPath: "infinityloop.config.cjs",
        commandKey: "sync",
        stepIndex: 0,
      },
    );

    await mergeTemplatePlugin.execute(payload, {
      cwd: targetRepo,
      variables: {},
    });

    const coreContent = await readFile(path.join(targetRepo, "core.txt"), "utf8");
    assert.equal(coreContent, "core-v2\n");
    const localContent = await readFile(path.join(targetRepo, "local.txt"), "utf8");
    assert.equal(localContent, "keep me\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("merge-template removes files when allowDeletes is true", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ill-merge-delete-"));

  try {
    const templateRepo = path.join(root, "template");
    const targetRepo = path.join(root, "target");

    await mkdir(templateRepo, { recursive: true });
    await writeFile(path.join(templateRepo, "core.txt"), "core-v2\n", "utf8");
    await writeFile(path.join(templateRepo, "old.txt"), "legacy\n", "utf8");
    await runGit(["init"], templateRepo);
    await runGit(["config", "user.name", "ILL Test"], templateRepo);
    await runGit(["config", "user.email", "ill-test@example.com"], templateRepo);
    await runGit(["add", "."], templateRepo);
    await runGit(["commit", "-m", "template v2"], templateRepo);
    const templateBranch = await getCurrentBranch(templateRepo);

    await mkdir(targetRepo, { recursive: true });
    await writeFile(path.join(targetRepo, "core.txt"), "core-v1\n", "utf8");
    await writeFile(path.join(targetRepo, "old.txt"), "to remove\n", "utf8");
    await runGit(["init"], targetRepo);
    await runGit(["config", "user.name", "ILL Test"], targetRepo);
    await runGit(["config", "user.email", "ill-test@example.com"], targetRepo);
    await runGit(["add", "."], targetRepo);
    await runGit(["commit", "-m", "target v1"], targetRepo);

    await runGit(["rm", "old.txt"], templateRepo);
    await runGit(["commit", "-m", "remove old"], templateRepo);

    const payload = mergeTemplatePlugin.parse(
      {
        type: "merge-template",
        repo: templateRepo,
        ref: templateBranch,
        allowDeletes: true,
        protectedPaths: [],
      },
      {
        configPath: "infinityloop.config.cjs",
        commandKey: "sync",
        stepIndex: 0,
      },
    );

    await mergeTemplatePlugin.execute(payload, {
      cwd: targetRepo,
      variables: {},
    });

    await assert.rejects(readFile(path.join(targetRepo, "old.txt"), "utf8"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("merge-template blocks deletions when allowDeletes is false", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ill-merge-block-delete-"));

  try {
    const templateRepo = path.join(root, "template");
    const targetRepo = path.join(root, "target");

    await mkdir(templateRepo, { recursive: true });
    await writeFile(path.join(templateRepo, "keep.txt"), "new\n", "utf8");
    await writeFile(path.join(templateRepo, "extra.txt"), "to-remove\n", "utf8");
    await runGit(["init"], templateRepo);
    await runGit(["config", "user.name", "ILL Test"], templateRepo);
    await runGit(["config", "user.email", "ill-test@example.com"], templateRepo);
    await runGit(["add", "."], templateRepo);
    await runGit(["commit", "-m", "template v1"], templateRepo);
    const templateBranch = await getCurrentBranch(templateRepo);

    await mkdir(targetRepo, { recursive: true });
    await writeFile(path.join(targetRepo, "keep.txt"), "old\n", "utf8");
    await writeFile(path.join(targetRepo, "extra.txt"), "local\n", "utf8");
    await runGit(["init"], targetRepo);
    await runGit(["config", "user.name", "ILL Test"], targetRepo);
    await runGit(["config", "user.email", "ill-test@example.com"], targetRepo);
    await runGit(["add", "."], targetRepo);
    await runGit(["commit", "-m", "target v1"], targetRepo);

    await runGit(["rm", "extra.txt"], templateRepo);
    await runGit(["commit", "-m", "delete extra"], templateRepo);

    const payload = mergeTemplatePlugin.parse(
      {
        type: "merge-template",
        repo: templateRepo,
        ref: templateBranch,
        allowDeletes: false,
        protectedPaths: [],
      },
      {
        configPath: "infinityloop.config.cjs",
        commandKey: "sync",
        stepIndex: 0,
      },
    );

    await assert.rejects(
      () =>
        mergeTemplatePlugin.execute(payload, {
          cwd: targetRepo,
          variables: {},
        }),
      /Template update wants to delete these files/,
    );

    const extraContent = await readFile(path.join(targetRepo, "extra.txt"), "utf8");
    assert.equal(extraContent, "local\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("merge-template blocks removal inside protected paths", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ill-merge-protected-delete-"));

  try {
    const templateRepo = path.join(root, "template");
    const targetRepo = path.join(root, "target");

    await mkdir(templateRepo, { recursive: true });
    await mkdir(path.join(templateRepo, "app/business"), { recursive: true });
    await writeFile(path.join(templateRepo, "app/business/keep.txt"), "new\n", "utf8");
    await runGit(["init"], templateRepo);
    await runGit(["config", "user.name", "ILL Test"], templateRepo);
    await runGit(["config", "user.email", "ill-test@example.com"], templateRepo);
    await runGit(["add", "."], templateRepo);
    await runGit(["commit", "-m", "template v1"], templateRepo);
    const templateBranch = await getCurrentBranch(templateRepo);

    await mkdir(targetRepo, { recursive: true });
    await mkdir(path.join(targetRepo, "app/business"), { recursive: true });
    await writeFile(path.join(targetRepo, "app/business/keep.txt"), "old\n", "utf8");
    await runGit(["init"], targetRepo);
    await runGit(["config", "user.name", "ILL Test"], targetRepo);
    await runGit(["config", "user.email", "ill-test@example.com"], targetRepo);
    await runGit(["add", "."], targetRepo);
    await runGit(["commit", "-m", "target v1"], targetRepo);

    await runGit(["rm", "app/business/keep.txt"], templateRepo);
    await runGit(["commit", "-m", "delete protected"], templateRepo);

    const payload = mergeTemplatePlugin.parse(
      {
        type: "merge-template",
        repo: templateRepo,
        ref: templateBranch,
        allowDeletes: true,
        protectedPaths: ["app/business"],
      },
      {
        configPath: "infinityloop.config.cjs",
        commandKey: "sync",
        stepIndex: 0,
      },
    );

    await assert.rejects(
      () =>
        mergeTemplatePlugin.execute(payload, {
          cwd: targetRepo,
          variables: {},
        }),
      /Template update touches protected paths/,
    );

    const keepContent = await readFile(path.join(targetRepo, "app/business/keep.txt"), "utf8");
    assert.equal(keepContent, "old\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
