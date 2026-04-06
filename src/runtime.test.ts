import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { builtinPlugins } from "./plugins";
import { runCommandByKey } from "./runtime";

test("runtime executes command steps sequentially", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ill-runtime-"));

  try {
    const hooksFile = path.join(root, "result", "Popup", "hooks.ts");
    const config = {
      commands: {
        patchHooks: [
          {
            type: "insert",
            file: "result/$name/hooks.ts",
            placeholder: "// Insert Hooks here",
            line: "createAppActions($name)",
          },
          {
            type: "remove-line",
            file: "result/$name/hooks.ts",
            line: "createAppActions($name)",
          },
        ],
      },
    };

    await mkdir(path.dirname(hooksFile), { recursive: true });
    await writeFile(hooksFile, "// Insert Hooks here", "utf8");

    const stepsCount = await runCommandByKey(
      config,
      "patchHooks",
      root,
      { name: "Popup" },
      builtinPlugins,
      "infinityloop.config.js",
    );

    assert.equal(stepsCount, 2);
    const content = await readFile(hooksFile, "utf8");
    assert.equal(content, "// Insert Hooks here");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime supports template functions and replace plugin", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ill-runtime-"));

  try {
    const hooksFile = path.join(root, "result", "SampleWidget", "hooks.ts");
    const config = {
      commands: {
        enhanceHooks: [
          {
            type: "insert",
            file: "result/$name/hooks.ts",
            placeholder: "// Insert Hooks here",
            line: "      ${name}: createAction(${name}Actions),",
          },
          {
            type: "insert",
            file: "result/$name/hooks.ts",
            placeholder: "// Insert Hooks here",
            line: "      ${Name}: createAction(${Name}Actions),",
          },
          {
            type: "replace",
            file: "result/$name/hooks.ts",
            search: "// Insert Hooks here",
            replace: "// ${Name} Hook",
          },
        ],
      },
    };

    await mkdir(path.dirname(hooksFile), { recursive: true });
    await writeFile(hooksFile, "// Insert Hooks here", "utf8");

    const stepsCount = await runCommandByKey(
      config,
      "enhanceHooks",
      root,
      {
        name: "SampleWidget",
        nameLower: "sampleWidget",
        namePascal: "SampleWidget",
      },
      builtinPlugins,
      "infinityloop.config.js",
    );

    assert.equal(stepsCount, 3);
    const content = await readFile(hooksFile, "utf8");
    assert.equal(
      content,
      [
        "// SampleWidget Hook",
        "      SampleWidget: createAction(SampleWidgetActions),",
        "      sampleWidget: createAction(sampleWidgetActions),",
      ].join("\n"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime respects step conditions via when", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ill-runtime-"));

  try {
    const hooksFile = path.join(root, "result", "Sample", "hooks.ts");
    const config = {
      commands: {
        conditional: [
          {
            type: "insert",
            when: "feature",
            file: "result/$name/hooks.ts",
            placeholder: "// Insert Hooks here",
            line: "feature: enabled",
          },
          {
            type: "insert",
            when: "!no-store",
            file: "result/$name/hooks.ts",
            placeholder: "// Insert Hooks here",
            line: "store: initialize",
          },
          {
            type: "insert",
            when: "no-store",
            file: "result/$name/hooks.ts",
            placeholder: "// Insert Hooks here",
            line: "store: skipped",
          },
        ],
      },
    };

    await mkdir(path.dirname(hooksFile), { recursive: true });
    await writeFile(hooksFile, "// Insert Hooks here", "utf8");

    const stepsCount = await runCommandByKey(
      config,
      "conditional",
      root,
      {
        name: "Sample",
        feature: "true",
        noStore: "false",
      },
      builtinPlugins,
      "infinityloop.config.js",
    );

    assert.equal(stepsCount, 2);
    const content = await readFile(hooksFile, "utf8");
    assert(content.includes("feature: enabled"));
    assert(content.includes("store: initialize"));
    assert(!content.includes("store: skipped"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
