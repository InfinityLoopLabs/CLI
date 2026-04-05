import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";

type InitFileOptions = {
  cwd: string;
  repo?: string;
  targetRepo?: string;
  ref?: string;
  force?: boolean;
};

type InitFileResult = {
  configPath: string;
};

const DEFAULT_TEMPLATE_REPO = "owner/template-repo";
const DEFAULT_TARGET_REPO = "owner/target-repo";
const DEFAULT_REF = "main";
const CONFIG_FILE_NAME = "infinityloop.config.js";

function renderConfigTemplate(templateRepo: string, targetRepo: string, ref: string): string {
  const templateRepoValue = JSON.stringify(templateRepo);
  const targetRepoValue = JSON.stringify(targetRepo);
  const refValue = JSON.stringify(ref);

  return `const TEMPLATE_REPO = ${templateRepoValue};
const TARGET_REPO = ${targetRepoValue};
const TEMPLATE_REF = ${refValue};

module.exports = {
  meta: {
    templateRepo: TEMPLATE_REPO,
    targetRepo: TARGET_REPO,
    templateRef: TEMPLATE_REF,
  },
  commands: {
    bootstrap: [
      {
        type: "download",
        repo: TEMPLATE_REPO,
        ref: TEMPLATE_REF,
        allowNonEmpty: true,
      },
    ],
    syncTemplate: [
      {
        type: "merge-template",
        repo: TEMPLATE_REPO,
        ref: TEMPLATE_REF,
        allowUnrelatedHistories: true,
      },
    ],
  },
};
`;
}

export async function createInitConfigFile(options: InitFileOptions): Promise<InitFileResult> {
  const configPath = path.resolve(options.cwd, CONFIG_FILE_NAME);
  if (existsSync(configPath) && !options.force) {
    throw new Error(`Config file already exists: ${configPath}. Use --force to overwrite.`);
  }

  const content = renderConfigTemplate(
    options.repo ?? DEFAULT_TEMPLATE_REPO,
    options.targetRepo ?? DEFAULT_TARGET_REPO,
    options.ref ?? DEFAULT_REF,
  );
  await writeFile(configPath, content, "utf8");

  return { configPath };
}
