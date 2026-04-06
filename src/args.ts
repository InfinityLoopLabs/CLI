import path from "node:path";
import type { CliOptions } from "./types";
import { normalizeKey } from "./shared/normalize-key";

function setParam(options: CliOptions, rawKey: string, value: string): void {
  const key = normalizeKey(rawKey);
  if (!key) {
    return;
  }
  if (!options.params) {
    options.params = {};
  }
  options.params[key] = value;
}

export function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = { cwd: process.cwd() };
  const positional: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const nextArg = args[i + 1];
    if (!arg) {
      continue;
    }

    if (arg.startsWith("--config=")) {
      options.configPath = arg.slice("--config=".length);
      continue;
    }

    if ((arg === "--config" || arg === "-c") && nextArg) {
      options.configPath = nextArg;
      i += 1;
      continue;
    }

    if (arg.startsWith("--cwd=")) {
      options.cwd = path.resolve(arg.slice("--cwd=".length));
      continue;
    }

    if (arg === "--cwd" && nextArg) {
      options.cwd = path.resolve(nextArg);
      i += 1;
      continue;
    }

    if (arg.startsWith("--name=")) {
      options.name = arg.slice("--name=".length);
      continue;
    }

    if ((arg === "--name" || arg === "-n") && nextArg) {
      options.name = nextArg;
      i += 1;
      continue;
    }

    if (arg.startsWith("--repo=")) {
      options.repo = arg.slice("--repo=".length);
      continue;
    }

    if (arg === "--repo" && nextArg) {
      options.repo = nextArg;
      i += 1;
      continue;
    }

    if (arg.startsWith("--target-repo=")) {
      options.targetRepo = arg.slice("--target-repo=".length);
      continue;
    }

    if (arg === "--target-repo" && nextArg) {
      options.targetRepo = nextArg;
      i += 1;
      continue;
    }

    if (arg.startsWith("--ref=")) {
      options.ref = arg.slice("--ref=".length);
      continue;
    }

    if (arg === "--ref" && nextArg) {
      options.ref = nextArg;
      i += 1;
      continue;
    }

    if (arg === "--force" || arg === "-f") {
      options.force = true;
      continue;
    }

    if (arg.startsWith("--no")) {
      let remainder = arg.slice(4);
      if (!remainder) {
        continue;
      }

      let explicitValue: string | undefined;
      const eqIndex = remainder.indexOf("=");
      if (eqIndex >= 0) {
        explicitValue = remainder.slice(eqIndex + 1);
        remainder = remainder.slice(0, eqIndex);
      }

      if (remainder.startsWith("-")) {
        remainder = remainder.slice(1);
      }

      if (!remainder) {
        continue;
      }

      const value = explicitValue ?? "false";
      setParam(options, remainder, value);
      setParam(options, `no-${remainder}`, "true");
      continue;
    }

    if (arg.startsWith("--")) {
      const withoutPrefix = arg.slice(2);
      if (!withoutPrefix) {
        continue;
      }

      const eqIndex = withoutPrefix.indexOf("=");
      if (eqIndex >= 0) {
        const key = withoutPrefix.slice(0, eqIndex);
        const value = withoutPrefix.slice(eqIndex + 1);
        setParam(options, key, value);
        continue;
      }

      if (nextArg && !nextArg.startsWith("-")) {
        setParam(options, withoutPrefix, nextArg);
        i += 1;
      } else {
        setParam(options, withoutPrefix, "true");
      }
      continue;
    }

    if (!arg.startsWith("-")) {
      positional.push(arg);
    }
  }

  options.commandKey = positional[0];
  options.commandArgs = positional.slice(1);
  return options;
}
