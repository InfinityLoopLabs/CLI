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

Run command keys declared in `infinityloop.config.*`:

```bash
ill addWidget Header
ill addService Auth
ill addOpenApiConfig Billing
ill removeWidget Header
ill removeService Auth
ill removeOpenApiConfig Billing
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
- `copy`: copy file/folder from `from` to `to` without substitutions.
- `download`: clone template repository and copy into `cwd` without `.git` and `.github`. `.gitignore` is preserved. Works in non-empty folders by default; set `allowNonEmpty: false` to require empty target.
- `merge-template`: подтягивает снапшот шаблона, строит 3-way patch и накладывает его поверх текущей рабочей копии. По умолчанию CLI предложит выбрать удаляемые файлы в интерактивном режиме. Если удалений быть не должно вовсе, установите `allowDeletes: false`. Массив `protectedPaths` (пути относительно корня проекта) позволяет заблокировать удаление конкретных директорий/файлов даже при включённых удалениях.
- `insert`: insert `line` after `placeholder` in `file`.
- `replace`: replace the first occurrence of `search` with `replace` in `file`.
- `rename`: replace tokens in file contents and file/directory names inside `target` with case preservation (`Sample` / `sample` / `SAMPLE`).
- `remove-line`: remove a line from `file` by text match.
- `remove`: delete file/folder at `target`.
- `read`: load variables from a key=value file (for example `.cli`) and inject them into the command context so subsequent steps can use `${PROJECT_NAME}` placeholders.

### Template values & variables

- Fields such as `file`, `placeholder`, `line`, `search`, and `replace` accept either a string with `$variable` / `${variable}` placeholders or a function `(variables) => string`.
- Available variables:
  - `name`, `namePascal`, `nameCamel`, `nameLower`, `nameSnake`, `nameKebab`, `nameScreamingSnake`
- Any extra CLI flag becomes a variable: `--store-name=SideMenu` exposes `${storeName}`, `--dry-run` sets `${dryRun}` to `"true"`, and disabling flags like `--no-store` / `--nostore` set `${store}` to `"false"` while `${noStore}` becomes `"true"`. Flag names are normalized to camelCase by stripping dashes/underscores, but you can still reference hyphenated names in `when` expressions (e.g. `when: "!no-store"`).
- The `read` step is typically used to load a `.cli` file with entries like `PROJECT_NAME=my-app`. Each `KEY=VALUE` pair becomes available via `${KEY}` or `${key}` in later steps.
- For `${variable}` syntax, the placeholder casing controls the transform: `${name}` lowers the first letter, `${Name}` capitalizes it, `${NAME}` uppercases the whole string. Plain `$variable` keeps the stored value.
- Example:

```js
{
  type: "insert",
  file: "app/features/services/$name/hooks.ts",
  placeholder: "// Services: Start",
  line: "  $nameLower: createAction(${name}Actions),",
}
```

### Conditional execution

- Every step may declare `when`, either as a string (`"store"`, `"!store"`) or an array of such strings. All conditions must be truthy for the step to run.
- Truthiness is based on the variable value: missing/`"false"`/`"0"`/empty strings are treated as `false`, everything else is `true`. Prefix `!` to invert the result.
- Example: skip store-related insertions when `--no-store` is provided.

```js
{
  type: "insert",
  when: "!no-store", // executes only when --no-store/--nostore is not provided
  file: "app/store/index.ts",
  placeholder: "// Services: Start",
  line: "  ${name}: ${Name}Reducer,",
}

// merge-template example that blocks deletions but still fetches updates
{
  type: "merge-template",
  repo: TEMPLATE_REPO,
  ref: TEMPLATE_REF,
  allowDeletes: false,
  protectedPaths: [".cli", "app/business"],
}
```
