import type { CommandPlugin } from "../types";
import { addPlugin } from "./add";
import { copyPlugin } from "./copy";
import { downloadPlugin } from "./download";
import { insertPlugin } from "./insert";
import { mergeTemplatePlugin } from "./merge-template";
import { replacePlugin } from "./replace";
import { renamePlugin } from "./rename";
import { removeLinePlugin } from "./remove-line";
import { removePlugin } from "./remove";

export const builtinPlugins: CommandPlugin[] = [
  addPlugin,
  copyPlugin,
  downloadPlugin,
  mergeTemplatePlugin,
  insertPlugin,
  replacePlugin,
  renamePlugin,
  removeLinePlugin,
  removePlugin,
];
