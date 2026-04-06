import assert from "node:assert/strict";
import test from "node:test";
import { parseArgs } from "./args";

test("parseArgs collects custom parameters with normalization", () => {
  const options = parseArgs([
    "generate",
    "--store=account",
    "--no-hooks",
    "--theme",
    "dark",
    "--dry-run",
  ]);

  assert.equal(options.commandKey, "generate");
  assert.deepEqual(options.commandArgs, []);
  assert.equal(options.params?.store, "account");
  assert.equal(options.params?.hooks, "false");
  assert.equal(options.params?.theme, "dark");
  assert.equal(options.params?.dryRun, "true");
});

test("parseArgs treats --nostore as standalone disable flag", () => {
  const options = parseArgs(["create", "--nostore"]);

  assert.equal(options.params?.store, "false");
  assert.equal(options.params?.noStore, "true");
});

test("parseArgs treats --no-store as disable flag with hyphen", () => {
  const options = parseArgs(["create", "--no-store"]);

  assert.equal(options.params?.store, "false");
  assert.equal(options.params?.noStore, "true");
});
