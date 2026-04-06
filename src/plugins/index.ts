import type { CommandPlugin } from "../types";
import { addPlugin } from "./add";
import { copyPlugin } from "./copy";
import { downloadPlugin } from "./download";
import { insertPlugin } from "./insert";
import { mergeTemplatePlugin } from "./merge-template";
import { renamePlugin } from "./rename";
import { removeLinePlugin } from "./remove-line";
import { removePlugin } from "./remove";

export const builtinPlugins: CommandPlugin[] = [
  addPlugin,
  copyPlugin,
  downloadPlugin,
  mergeTemplatePlugin,
  insertPlugin,
  renamePlugin,
  removeLinePlugin,
  removePlugin,
];
