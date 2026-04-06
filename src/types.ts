export type Variables = Record<string, string | undefined>;

export type CliOptions = {
  cwd: string;
  configPath?: string;
  commandKey?: string;
  commandArgs?: string[];
  name?: string;
  repo?: string;
  targetRepo?: string;
  ref?: string;
  force?: boolean;
  params?: Record<string, string>;
};

export type CommandStepRaw = {
  type: string;
  when?: string | string[];
  [key: string]: unknown;
};

export type ProjectConfig = {
  commands?: Record<string, CommandStepRaw[]>;
};

export type LoadedProjectConfig = {
  config: ProjectConfig;
  configPath?: string;
};

export type PluginParseContext = {
  configPath: string;
  commandKey: string;
  stepIndex: number;
};

export type PluginExecuteContext = {
  cwd: string;
  variables: Variables;
};

export type CommandPlugin = {
  type: string;
  parse: (rawStep: CommandStepRaw, context: PluginParseContext) => unknown;
  execute: (payload: unknown, context: PluginExecuteContext) => Promise<void>;
};
