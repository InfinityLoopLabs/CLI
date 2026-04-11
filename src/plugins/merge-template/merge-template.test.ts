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

async function resolveRef(ref: string, cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["rev-parse", ref], { cwd });
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

    const result = await mergeTemplatePlugin.execute(payload, {
      cwd: targetRepo,
      variables: {},
    });

    const coreContent = await readFile(path.join(targetRepo, "core.txt"), "utf8");
    assert.equal(coreContent, "core-v2\n");
    const localContent = await readFile(path.join(targetRepo, "local.txt"), "utf8");
    assert.equal(localContent, "keep me\n");
    assert.equal(result?.messages?.some(message => message.startsWith("Operation: ")), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("merge-template keeps local file when template adds same path", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ill-merge-local-add-conflict-"));

  try {
    const templateRepo = path.join(root, "template");
    const targetRepo = path.join(root, "target");

    await mkdir(templateRepo, { recursive: true });
    await runGit(["init"], templateRepo);
    await runGit(["config", "user.name", "ILL Test"], templateRepo);
    await runGit(["config", "user.email", "ill-test@example.com"], templateRepo);
    await writeFile(path.join(templateRepo, "README.md"), "template\n", "utf8");
    await runGit(["add", "."], templateRepo);
    await runGit(["commit", "-m", "template v1"], templateRepo);
    await writeFile(path.join(templateRepo, "infinityloop.config.cjs"), "module.exports = { template: true }\n", "utf8");
    await runGit(["add", "infinityloop.config.cjs"], templateRepo);
    await runGit(["commit", "-m", "template adds config"], templateRepo);
    const templateBranch = await getCurrentBranch(templateRepo);

    await mkdir(targetRepo, { recursive: true });
    await writeFile(path.join(targetRepo, "README.md"), "template\n", "utf8");
    await runGit(["init"], targetRepo);
    await runGit(["config", "user.name", "ILL Test"], targetRepo);
    await runGit(["config", "user.email", "ill-test@example.com"], targetRepo);
    await runGit(["add", "."], targetRepo);
    await runGit(["commit", "-m", "target base"], targetRepo);

    const localConfigPath = path.join(targetRepo, "infinityloop.config.cjs");
    await writeFile(localConfigPath, "module.exports = { local: true }\n", "utf8");

    const payload = mergeTemplatePlugin.parse(
      {
        type: "merge-template",
        repo: templateRepo,
        ref: templateBranch,
        protectedPaths: [],
      },
      {
        configPath: "infinityloop.config.cjs",
        commandKey: "sync",
        stepIndex: 0,
      },
    );

    const result = await mergeTemplatePlugin.execute(payload, {
      cwd: targetRepo,
      variables: {},
    });

    const localContent = await readFile(localConfigPath, "utf8");
    assert.equal(localContent, "module.exports = { local: true }\n");
    assert.equal(
      result?.messages?.some(message => message.includes("Template additions skipped (existing local paths): 1")),
      true,
    );
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

test("merge-template applies template deletions regardless of allowDeletes flag", async () => {
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

    await mergeTemplatePlugin.execute(payload, {
      cwd: targetRepo,
      variables: {},
    });

    await assert.rejects(readFile(path.join(targetRepo, "extra.txt"), "utf8"));
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

    await mergeTemplatePlugin.execute(payload, {
      cwd: targetRepo,
      variables: {},
    });

    const keepContent = await readFile(path.join(targetRepo, "app/business/keep.txt"), "utf8");
    assert.equal(keepContent, "old\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("merge-template ignores all add/delete/modify changes inside protected paths", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ill-merge-protected-tree-"));

  try {
    const templateRepo = path.join(root, "template");
    const targetRepo = path.join(root, "target");

    await mkdir(path.join(templateRepo, "app/features/widgets/Headless"), { recursive: true });
    await writeFile(path.join(templateRepo, "core.txt"), "core-v1\n", "utf8");
    await writeFile(path.join(templateRepo, "app/features/widgets/Headless/index.tsx"), "template-v1\n", "utf8");
    await writeFile(path.join(templateRepo, "app/features/widgets/Headless/keep.ts"), "keep-v1\n", "utf8");
    await runGit(["init"], templateRepo);
    await runGit(["config", "user.name", "ILL Test"], templateRepo);
    await runGit(["config", "user.email", "ill-test@example.com"], templateRepo);
    await runGit(["add", "."], templateRepo);
    await runGit(["commit", "-m", "template v1"], templateRepo);
    const templateBranch = await getCurrentBranch(templateRepo);

    await writeFile(path.join(templateRepo, "core.txt"), "core-v2\n", "utf8");
    await writeFile(path.join(templateRepo, "app/features/widgets/Headless/index.tsx"), "template-v2\n", "utf8");
    await runGit(["rm", "app/features/widgets/Headless/keep.ts"], templateRepo);
    await writeFile(path.join(templateRepo, "app/features/widgets/Headless/new.ts"), "new-file\n", "utf8");
    await runGit(["add", "."], templateRepo);
    await runGit(["commit", "-m", "template v2"], templateRepo);

    await mkdir(path.join(targetRepo, "app/features/widgets/Headless"), { recursive: true });
    await writeFile(path.join(targetRepo, "core.txt"), "core-v1\n", "utf8");
    await writeFile(path.join(targetRepo, "app/features/widgets/Headless/index.tsx"), "target-local\n", "utf8");
    await writeFile(path.join(targetRepo, "app/features/widgets/Headless/keep.ts"), "target-keep\n", "utf8");
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
        allowDeletes: true,
        protectedPaths: ["app/features"],
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

    assert.equal(await readFile(path.join(targetRepo, "core.txt"), "utf8"), "core-v2\n");
    assert.equal(
      await readFile(path.join(targetRepo, "app/features/widgets/Headless/index.tsx"), "utf8"),
      "target-local\n",
    );
    assert.equal(
      await readFile(path.join(targetRepo, "app/features/widgets/Headless/keep.ts"), "utf8"),
      "target-keep\n",
    );
    await assert.rejects(readFile(path.join(targetRepo, "app/features/widgets/Headless/new.ts"), "utf8"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("merge-template preserves local package json changes while applying template updates", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ill-merge-package-json-"));

  try {
    const templateRepo = path.join(root, "template");
    const targetRepo = path.join(root, "target");

    await mkdir(templateRepo, { recursive: true });
    await writeFile(
      path.join(templateRepo, "package.json"),
      '{\n  "name": "sample-frontend",\n  "version": "1.0.0"\n}\n',
      "utf8",
    );
    await runGit(["init"], templateRepo);
    await runGit(["config", "user.name", "ILL Test"], templateRepo);
    await runGit(["config", "user.email", "ill-test@example.com"], templateRepo);
    await runGit(["add", "."], templateRepo);
    await runGit(["commit", "-m", "template v1"], templateRepo);
    const templateBranch = await getCurrentBranch(templateRepo);

    await writeFile(
      path.join(templateRepo, "package.json"),
      '{\n  "name": "sample-frontend",\n  "version": "2.0.0"\n}\n',
      "utf8",
    );
    await runGit(["add", "package.json"], templateRepo);
    await runGit(["commit", "-m", "template v2"], templateRepo);

    await mkdir(targetRepo, { recursive: true });
    await writeFile(
      path.join(targetRepo, "package.json"),
      '{\n  "name": "sample-frontend",\n  "version": "1.0.0"\n}\n',
      "utf8",
    );
    await runGit(["init"], targetRepo);
    await runGit(["config", "user.name", "ILL Test"], targetRepo);
    await runGit(["config", "user.email", "ill-test@example.com"], targetRepo);
    await runGit(["add", "."], targetRepo);
    await runGit(["commit", "-m", "target v1"], targetRepo);

    await writeFile(
      path.join(targetRepo, "package.json"),
      '{\n  "name": "react-polygon",\n  "version": "1.0.0"\n}\n',
      "utf8",
    );

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

    assert.equal(
      await readFile(path.join(targetRepo, "package.json"), "utf8"),
      '{\n  "name": "react-polygon",\n  "version": "2.0.0"\n}\n',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("merge-template uses template history baseline on repeated sync", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ill-merge-history-state-"));

  try {
    const templateRepo = path.join(root, "template");
    const targetRepo = path.join(root, "target");

    await mkdir(templateRepo, { recursive: true });
    await writeFile(path.join(templateRepo, "core.txt"), "core-v1\n", "utf8");
    await runGit(["init"], templateRepo);
    await runGit(["config", "user.name", "ILL Test"], templateRepo);
    await runGit(["config", "user.email", "ill-test@example.com"], templateRepo);
    await runGit(["add", "."], templateRepo);
    await runGit(["commit", "-m", "template v1"], templateRepo);
    const templateBranch = await getCurrentBranch(templateRepo);
    const templateV1Commit = await resolveRef("HEAD", templateRepo);

    await mkdir(targetRepo, { recursive: true });
    await writeFile(path.join(targetRepo, "core.txt"), "core-v1\n", "utf8");
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

    await writeFile(path.join(targetRepo, "core.txt"), "core-local-custom\n", "utf8");

    await writeFile(path.join(templateRepo, "new-shared.txt"), "shared-v2\n", "utf8");
    await runGit(["add", "."], templateRepo);
    await runGit(["commit", "-m", "template v2"], templateRepo);
    const templateV2Commit = await resolveRef("HEAD", templateRepo);

    await mergeTemplatePlugin.execute(payload, {
      cwd: targetRepo,
      variables: {},
    });

    assert.equal(await readFile(path.join(targetRepo, "core.txt"), "utf8"), "core-local-custom\n");
    assert.equal(await readFile(path.join(targetRepo, "new-shared.txt"), "utf8"), "shared-v2\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("merge-template dry-run does not apply patch", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ill-merge-dry-run-"));

  try {
    const templateRepo = path.join(root, "template");
    const targetRepo = path.join(root, "target");

    await mkdir(templateRepo, { recursive: true });
    await writeFile(path.join(templateRepo, "core.txt"), "core-v1\n", "utf8");
    await runGit(["init"], templateRepo);
    await runGit(["config", "user.name", "ILL Test"], templateRepo);
    await runGit(["config", "user.email", "ill-test@example.com"], templateRepo);
    await runGit(["add", "."], templateRepo);
    await runGit(["commit", "-m", "template v1"], templateRepo);
    const templateBranch = await getCurrentBranch(templateRepo);

    await mkdir(targetRepo, { recursive: true });
    await writeFile(path.join(targetRepo, "core.txt"), "core-v1\n", "utf8");
    await runGit(["init"], targetRepo);
    await runGit(["config", "user.name", "ILL Test"], targetRepo);
    await runGit(["config", "user.email", "ill-test@example.com"], targetRepo);
    await runGit(["add", "."], targetRepo);
    await runGit(["commit", "-m", "target v1"], targetRepo);

    await writeFile(path.join(templateRepo, "core.txt"), "core-v2\n", "utf8");
    await runGit(["add", "core.txt"], templateRepo);
    await runGit(["commit", "-m", "template v2"], templateRepo);

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
      variables: {
        dryRun: "true",
      },
    });

    assert.equal(await readFile(path.join(targetRepo, "core.txt"), "utf8"), "core-v1\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("merge-template keeps product-only files on first sync even with allowDeletes true", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ill-merge-keep-product-only-"));

  try {
    const templateRepo = path.join(root, "template");
    const targetRepo = path.join(root, "target");

    await mkdir(templateRepo, { recursive: true });
    await writeFile(path.join(templateRepo, "managed.txt"), "managed-v1\n", "utf8");
    await runGit(["init"], templateRepo);
    await runGit(["config", "user.name", "ILL Test"], templateRepo);
    await runGit(["config", "user.email", "ill-test@example.com"], templateRepo);
    await runGit(["add", "."], templateRepo);
    await runGit(["commit", "-m", "template v1"], templateRepo);
    const templateBranch = await getCurrentBranch(templateRepo);

    await writeFile(path.join(templateRepo, "managed.txt"), "managed-v2\n", "utf8");
    await runGit(["add", "managed.txt"], templateRepo);
    await runGit(["commit", "-m", "template v2"], templateRepo);

    await mkdir(targetRepo, { recursive: true });
    await writeFile(path.join(targetRepo, "managed.txt"), "managed-v1\n", "utf8");
    await writeFile(path.join(targetRepo, "feature-only.txt"), "local-only\n", "utf8");
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

    assert.equal(await readFile(path.join(targetRepo, "managed.txt"), "utf8"), "managed-v2\n");
    assert.equal(await readFile(path.join(targetRepo, "feature-only.txt"), "utf8"), "local-only\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
