import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { renamePlugin } from "./index";

test("rename plugin updates case-aware tokens in file names and content", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ill-rename-"));

  try {
    const targetDir = path.join(root, "widgets", "Header");
    const sampleDir = path.join(targetDir, "templates", "Sample");
    await mkdir(sampleDir, { recursive: true });

    await writeFile(
      path.join(targetDir, "mapSample.ts"),
      "export type SampleDTO = {}\nexport const sampleList = [mapSample]\n",
      "utf8",
    );
    await writeFile(path.join(sampleDir, "SampleView.tsx"), "export const Sample = () => null;\n", "utf8");

    const payload = renamePlugin.parse(
      {
        type: "rename",
        target: "widgets/$name",
        replace: [{ Sample: "$name" }],
      },
      {
        configPath: "infinityloop.config.cjs",
        commandKey: "addWidget",
        stepIndex: 1,
      },
    );

    await renamePlugin.execute(payload, {
      cwd: root,
      variables: { name: "Header" },
    });

    const renamedFile = await readFile(path.join(targetDir, "mapHeader.ts"), "utf8");
    assert.match(renamedFile, /HeaderDTO/);
    assert.match(renamedFile, /headerList/);
    assert.match(renamedFile, /mapHeader/);

    const renamedTemplate = await readFile(path.join(targetDir, "templates", "Header", "HeaderView.tsx"), "utf8");
    assert.match(renamedTemplate, /export const Header =/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
