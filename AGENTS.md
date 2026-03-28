# Project Agent Instructions

## Task Management

- Use `todo.sh` for all development stories and task tracking.
- Before starting work, run `todo.sh -p list` to see current tasks.
- Mark tasks in progress and completed using `todo.sh` as you work.
- Never create or track TODOs inside markdown files. `todo.sh` is the single source of truth.

## Coding Style: Object-Oriented Programming (Mandatory)

All source code in `src/` **must** use an object-oriented style:

- **Classes over free functions.** Every module exposes one or more classes, not standalone `export function` declarations.
- **Configuration via constructor injection.** Runtime settings (e.g. Obsidian vault config) are passed into the constructor and stored as `private readonly` fields.
- **Static members for true constants.** Regex patterns and other compile-time constants live as `static readonly` on the class.
- **Interfaces for configuration objects.** Use plain `interface` types (not classes) for option bags passed to constructors.
- **No barrel re-exports of loose functions.** Consumers import the class and call methods on an instance.

## Test-Driven Development (Mandatory)

TDD is **non-negotiable** for this project. Every piece of logic must follow the Red-Green-Refactor cycle:

1. **Red:** Write a failing test first that describes the expected behavior.
2. **Green:** Write the minimal code to make the test pass.
3. **Refactor:** Clean up the implementation while keeping tests green.

### Rules

- Never write implementation code without a failing test that demands it.
- Never skip ahead to implementation "because it's obvious." Write the test first.
- Each public method in `src/task-parser.ts`, `src/id-engine.ts`, `src/indentation-handler.ts`, and `src/utils.ts` must have corresponding tests.
- Tests live in a `tests/` directory mirroring the `src/` structure.
- Run the full test suite after every change to confirm nothing is broken.
- If a bug is found, write a test that reproduces it before fixing it.

### Test Scope

- **Unit tests** for all pure functions (task-parser, id-engine, utils).
- **Integration tests** for indentation-handler logic (mocked Editor API).
- Edge cases must be covered: non-task lines, multi-level indent/outdent, manual markers, ID collisions.

### Mutation Testing

- Every source file that has unit tests must also pass StrykerJS mutation testing.
- After writing or changing tests, always run `npm test` (not just `npm run test:unit`) to verify that mutations are killed.
- Surviving mutants indicate weak tests — fix them before moving on.

## NPM Scripts

Always use the defined npm scripts instead of invoking tools directly:

- `npm test` — run the full test suite (vitest + StrykerJS mutation testing)
- `npm run test:unit` — run unit tests only (vitest)
- `npm run test:watch` — run unit tests in watch mode
- `npm run test:mutation` — run mutation testing only (StrykerJS)
- `npm run test:mutation:incremental` — run mutation testing incrementally
- `npm run build` — type-check and build for production
- `npm run dev` — start esbuild in watch mode
- `npm run lint` — run ESLint
- `npm run check` — run all CI checks locally (lint, type-check, test, build)

## Obsidian Plugin Development

Load the `obsidian-plugin-dev` skill before doing any Obsidian plugin work. It contains all API references, guidelines, and best practices for this project.
