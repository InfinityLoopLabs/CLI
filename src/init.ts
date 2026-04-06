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
const DEFAULT_REF = "main";
const CONFIG_FILE_NAME = "infinityloop.config.js";

function renderConfigTemplate(templateRepo: string, ref: string): string {
  const templateRepoValue = JSON.stringify(templateRepo);
  const refValue = JSON.stringify(ref);

  return `const TEMPLATE_REPO = ${templateRepoValue};
const TEMPLATE_REF = ${refValue};

module.exports = {
  commands: {
    sync: [
      {
        type: "merge-template",
        repo: TEMPLATE_REPO,
        ref: TEMPLATE_REF,
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
    options.ref ?? DEFAULT_REF,
  );
  await writeFile(configPath, content, "utf8");

  return { configPath };
}
