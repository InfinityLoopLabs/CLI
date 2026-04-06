import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { copyPlugin } from "./index";

test("copy plugin copies directory as is", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ill-copy-"));

  try {
    const sourceDir = path.join(root, "template");
    await mkdir(path.join(sourceDir, "nested"), { recursive: true });
    await writeFile(path.join(sourceDir, "index.ts"), "export const Sample = 1;\n", "utf8");
    await writeFile(path.join(sourceDir, "nested", "sample.txt"), "sample", "utf8");

    const payload = copyPlugin.parse(
      {
        type: "copy",
        from: "template",
        to: "target/$name",
      },
      {
        configPath: "infinityloop.config.cjs",
        commandKey: "addWidget",
        stepIndex: 0,
      },
    );

    await copyPlugin.execute(payload, {
      cwd: root,
      variables: { name: "Header" },
    });

    const indexContent = await readFile(path.join(root, "target", "Header", "index.ts"), "utf8");
    assert.equal(indexContent, "export const Sample = 1;\n");
    const nestedContent = await readFile(path.join(root, "target", "Header", "nested", "sample.txt"), "utf8");
    assert.equal(nestedContent, "sample");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
