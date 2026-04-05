# ILL CLI (`@infinityloop.labs/ai-cli`)

Config-driven CLI runner for template/bootstrap and sync workflows.

## What Was Done

- Moved CLI implementation from legacy `code/` layout to root `src/` layout.
- Switched build setup to `rollup.config.mjs` + TypeScript declarations output in `dist/`.
- Added executable CLI entrypoint (`dist/cli.js`) with aliases: `ill`, `aic`, `infinity-cli`.
- Kept plugin-based runtime and covered key paths with tests.

## Install

As a package dependency:

```bash
npm install @infinityloop.labs/ai-cli
```

Alternative package managers:

```bash
yarn add @infinityloop.labs/ai-cli
pnpm add @infinityloop.labs/ai-cli
```

Global install (optional):

```bash
npm install -g @infinityloop.labs/ai-cli
```

## CLI Commands

Show help:

```bash
ill --help
```

Initialize config in current folder:

```bash
ill init --repo owner/template-repo --target-repo owner/product-repo --ref main
```

Sync with template repository using configured command:

```bash
ill sync
```

Run any configured command key:

```bash
ill <commandKey> --name MyFeature
```

Extended form:

```bash
ill <commandKey> --name MyFeature --config ./infinityloop.config.js --cwd .
```

Supported command aliases:

- `ill`
- `aic`
- `infinity-cli`

## NPM Scripts

- `npm run build` - clean, bundle, generate declaration files, set execute bit on CLI output.
- `npm run clean` - remove `dist/`.
- `npm run test` - run Node test suite (`src/**/*.test.ts`).
- `npm run typecheck` - TypeScript check without emit.
- `npm run watch` - TypeScript watch mode.
- `npm run start` - build and run CLI from `dist/cli.js`.

## Config

CLI auto-detects one of:

- `infinityloop.config.js`
- `infinityloop.config.mjs`
- `infinityloop.config.cjs`

`commands` is a map where each key is a command and value is an array of steps.

```js
module.exports = {
  commands: {
    createWidget: [
      {
        type: "add",
        from: "_templates/react_template/_template/widget",
        to: "generated/widgets/$name",
        replace: [{ Sample: "$name" }, { sample: "$name" }],
      },
    ],
    removeWidget: [
      {
        type: "remove",
        target: "generated/widgets/$name",
      },
    ],
  },
};
```

## Step Types

- `add`: copy file/folder from `from` to `to` with optional `replace`.
- `download`: clone template repository and copy into `cwd` without `.git` and `.github`. `.gitignore` is preserved. Works in non-empty folders by default; set `allowNonEmpty: false` to require empty target.
- `merge-template`: fetch and merge template repository into current git project, then mirror full template snapshot so deletions and additions are applied automatically.
- `insert`: insert `line` after `placeholder` in `file`.
- `remove-line`: remove a line from `file` by text match.
- `remove`: delete file/folder at `target`.
