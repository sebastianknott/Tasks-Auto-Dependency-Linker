# Restructure for low coupling and high cohesion

Plan document for the task "Restructure code to better reflect low coupling, high cohesion".

This file records the analysis, the target structure, and the commit sequence. It carries no task state; execution tracking lives outside the repository.

Status: planned, not started. Analysis performed against commit `0088ae9`. Scope and naming settled before the work started, see section 7.

## 1. Baseline measurements

Twenty files, 2900 lines, all flat in `src/`. The import graph forms a clean DAG, so the problem is not tangled dependencies. Two things are wrong: responsibilities sit in the wrong classes, and nothing enforces a layer order.

FTA scores at baseline (`npx fta src --json`), hard cap 60, target 50:

| File | cyclo | lines | FTA |
|---|---|---|---|
| line-write-arbiter.ts | 35 | 176 | 54.5 |
| main.ts | 4 | 91 | 52.8 |
| marker-accessor.ts | 6 | 115 | 52.5 |
| editor-processor.ts | 21 | 147 | 52.4 |
| task-parser.ts | 14 | 107 | 49.5 |
| metadata-sync-cache.ts | 10 | 99 | 49.5 |
| task-metadata-parser.ts | 15 | 112 | 49.4 |
| indentation-handler.ts | 16 | 104 | 48.5 |
| id-engine.ts | 16 | 101 | 48.3 |
| plugin-triggers.ts | 5 | 71 | 47.6 |
| line-snapshot-store.ts | 8 | 69 | 46.1 |
| relationship-analyzer.ts | 18 | 73 | 44.9 |
| metadata-inheritor.ts | 9 | 61 | 44.0 |
| cursor-guard.ts | 4 | 39 | 42.5 |
| cursor-line-watcher.ts | 4 | 30 | 39.2 |
| utils.ts | 3 | 25 | 38.6 |
| cache-coordinator.ts | 2 | 64 | 11.2 |
| types.ts | 1 | 17 | 9.4 |
| obsidian-editor-adapter.ts | 1 | 21 | 9.1 |
| line-splicer.ts | 2 | 8 | 9.1 |

`main.ts` scores 52.8 on a cyclomatic complexity of 4. Its weight comes from Halstead volume in `buildComponents`, which wires fifteen imports.

## 2. Defects found

### 2.1 IndentationHandler holds two disjoint method clusters

`src/indentation-handler.ts:21`.

- Link cluster: `prepareForLinkPass`, `processLine`. Stateful through `this.snapshot`, uses all four injected collaborators.
- Cleanup cluster: `removeStaleDeps`, `removeDanglingDeps`, `isIdReferencedAsDep`. Pure string transforms, touch only `this.parser`, share no state with the link cluster.

Call-site counts confirm the separation. Each cleanup method has exactly one caller, all three inside `EditorProcessor`'s cleanup pass, never the link pass. The class name also stopped describing the class: three of its five public methods ignore indentation.

### 2.2 id-engine.ts bundles three concerns

`src/id-engine.ts` exports `IdEngine`, `FileEntry`, `MarkerCache`, `IdCache`, `DepCache`.

Consumer analysis shows zero overlap:

- `generateUniqueId` has one caller, `src/indentation-handler.ts:102`.
- `generateId` is called only from inside `IdEngine`.
- `collectAllIds` and `collectAllDepIds` are called only by `IdCache.extract` and `DepCache.extract`.
- `src/cache-coordinator.ts` imports the file for the caches alone.
- `src/metadata-sync-cache.ts:13` imports the file for the `FileEntry` type alone.

`FileEntry` describes a cache input, not an ID engine concept. Its placement forces a `cache` to `linking` import edge that breaks any clean layer order.

### 2.3 LineWriteArbiter carries five responsibilities

`src/line-write-arbiter.ts`, 352 lines, FTA 54.5, the closest file to the cap.

1. Pass lifecycle and state rotation: `beginPass`, `endPass`, `seedFromText`.
2. Suppression and verification derivation: `detectSuppression`, `detectSuppressedMarkers`, `detectSuppressedDeps`, `computeIndeterminate`.
3. `LineEditor` decoration: `lineCount`, `getLine`, `setLine`.
4. Proposal reconciliation: `correctProposal`, `correctDeps`, `desiredDepPresence`.
5. Query facade: `isSuppressed`, `isIndeterminate`, `getSuppressedDepIds`, `getFrozenDepsForIndeterminateLine`, `getFrozenIdForCursorLine`.

### 2.4 EditorProcessor envies LineWriteArbiter

`src/editor-processor.ts` calls five separate arbiter query methods to reassemble the arbiter's own per-pass state. One immutable verdict object replaces all five reads.

### 2.5 EditorProcessor mixes orchestration with three cleanup sub-passes

Six constructor dependencies behind an `eslint-disable-next-line max-params` at `src/editor-processor.ts:45`, plus per-call mutable state in `this.lines` and `this.currentBlock`.

### 2.6 main.ts does four jobs

Tasks plugin gating, vault internals config reading, component graph construction, and active editor dispatch.

### 2.7 Nothing enforces import direction

`eslint.config.mts` configures no `import/*` rules. A future edit could make `task-parser.ts` import `editor-processor.ts` and no gate would fire.

## 3. Target structure

Six folders under `src/`, plus three files that stay at the root.

```
src/
  types.ts          EditorPositionLike, LineEditor, EditorLike, MarkerCacheLike, FileEntry
  utils.ts          Debounce
  main.ts           composition root
  parsing/          line-splicer, task-parser, task-metadata-parser,
                    marker-accessor, relationship-analyzer, marker-scanner*
  cache/            marker-cache*, metadata-sync-cache, cache-coordinator
  linking/          id-generator*, task-linker*, dependency-cleaner*, metadata-inheritor
  editing/          line-snapshot-store, suppression-detector*, proposal-reconciler*,
                    line-write-arbiter, cursor-guard
  processing/       editor-processor, link-pass*, cleanup-pass*
  obsidian/         plugin-triggers, obsidian-editor-adapter, cursor-line-watcher,
                    indent-config-reader*, component-graph*
```

Files marked `*` do not exist yet. A split in section 4 creates each one.

### 3.1 Layer order

A module may import from its own folder, from any folder to its right, and from `types.ts` or `utils.ts`. It may never import leftward.

```
obsidian -> processing -> editing -> linking -> cache -> parsing -> {types, utils}
```

`main.ts` sits outside the order. As the composition root it imports from every layer.

### 3.2 Edge verification

Every current import edge checked against the order above:

| Module | Imports | Verdict |
|---|---|---|
| marker-accessor (parsing) | task-parser, task-metadata-parser | same layer |
| marker-scanner (parsing) | task-parser | same layer |
| relationship-analyzer (parsing) | task-parser | same layer |
| marker-cache (cache) | marker-scanner, types | downward |
| metadata-sync-cache (cache) | relationship-analyzer, task-parser, task-metadata-parser, types | downward |
| cache-coordinator (cache) | marker-cache, metadata-sync-cache | same layer |
| metadata-inheritor (linking) | marker-accessor, metadata-sync-cache | downward |
| task-linker (linking) | task-parser, relationship-analyzer, id-generator, metadata-inheritor, types | downward and same layer |
| dependency-cleaner (linking) | task-parser | downward |
| line-snapshot-store (editing) | marker-accessor, types | downward |
| suppression-detector (editing) | marker-accessor, line-snapshot-store | downward and same layer |
| proposal-reconciler (editing) | marker-accessor | downward |
| line-write-arbiter (editing) | marker-accessor, line-snapshot-store, suppression-detector, proposal-reconciler, types | downward and same layer |
| cursor-guard (editing) | types | downward |
| editor-processor (processing) | link-pass, cleanup-pass, cursor-guard, line-write-arbiter, types | downward and same layer |
| link-pass (processing) | task-linker, task-parser, line-write-arbiter | downward |
| cleanup-pass (processing) | dependency-cleaner, relationship-analyzer, task-parser, line-write-arbiter, types | downward |
| plugin-triggers (obsidian) | cache-coordinator, line-write-arbiter, cursor-line-watcher, utils | downward and same layer |

No cycles, no leftward edges, once `FileEntry` moves out of `id-engine.ts`.

## 4. Commit sequence

Order the work as move, then enforce, then split. Every risky split then lands inside a layout that ESLint already polices.

### Phase 1: layering

**C1. Move `FileEntry` from `id-engine.ts` to `types.ts`.**

`src/metadata-sync-cache.ts:13` imports `id-engine` for this type and nothing else. That single edge is what would otherwise force `cache` to sit above `parsing`.

**C2. Move all files into the six folders.**

`git mv` plus relative import rewrites in `src/` and `tests/`. No logic changes.

Config impact, verified: `stryker.config.mjs` mutates `src/**/*.ts`, `vitest.config.ts` covers `src/**/*.ts`, `eslint.config.mts` targets `src/**/*.ts`, `fta src` recurses, `esbuild.config.mjs` keeps the entry point `src/main.ts`. `tsconfig.json` sets `baseUrl: "src"` but every import in the codebase is relative, so the setting has no effect on the move.

### Phase 2: enforcement

**C3. Add `import/no-restricted-paths` zones and `import/no-cycle`.**

`eslint-plugin-import@2.32.0` already sits in `node_modules` as a transitive dependency of `eslint-plugin-obsidianmd`, and exposes both rules. Two things to settle first:

1. Whether the `import/` namespace resolves inside the `src/**/*.ts` config block through `obsidianmd.configs.recommended`, or whether `eslint.config.mts` needs its own `plugins` registration.
2. Adding `eslint-plugin-import` to `devDependencies`. The project forbids importing a package it never declared, so the entry goes in even though npm downloads nothing new. Confirm before running the install.

### Phase 3: cohesion splits

**C4. Split `id-engine.ts` three ways.**

- `parsing/marker-scanner.ts` gains `MarkerScanner` with `collectAllIds` and `collectAllDepIds`.
- `linking/id-generator.ts` gains `IdGenerator` with `generateId` and `generateUniqueId`.
- `cache/marker-cache.ts` gains `MarkerCache`, `IdCache`, `DepCache`.

`MarkerCache` takes a `MarkerScanner` instead of an `IdEngine`. Split `tests/unit/id-engine.test.ts` (628 lines) into three files.

**C5. Split `IndentationHandler`.**

- `linking/dependency-cleaner.ts` gains `DependencyCleaner` with `removeStaleDeps`, `removeDanglingDeps`, `isIdReferencedAsDep`. It needs only a `TaskParser`.
- `linking/task-linker.ts` gains `TaskLinker` with `prepareForLinkPass` and `processLine`.

Split `tests/integration/indentation-handler.test.ts` (625 lines). Rewire `main.ts` and the cleanup pass.

**Design review, before C6.** Required, not optional. Pressure-test the verdict-object boundary before any code changes in C6 or C7, against `src/line-write-arbiter.ts` in full and the C6 and C7 descriptions below, together with the three earlier defects in this area: the `setLine` return contract, a bare fragment on the cursor line steering a cleanup sub-pass onto the parent, and backspacing inside an id rewriting the parent every keystroke. Three questions to answer: whether the verdict object is the right seam, whether suppression rotation genuinely belongs on the arbiter rather than the detector, and what the split would break that the existing 1133-line test file would not catch. Fold the answer into this document before writing code.

**C6. Extract `editing/suppression-detector.ts`.**

Moves `detectSuppression`, `detectSuppressedMarkers`, `detectSuppressedDeps`, and `computeIndeterminate`. Returns one immutable per-pass verdict:

```ts
interface CursorLineVerdict {
	readonly suppressedTypes: ReadonlySet<MarkerType>;
	readonly suppressedDepIds: ReadonlySet<string>;
	readonly verifiedTypes: ReadonlySet<MarkerType>;
	readonly verifiedDepIds: ReadonlySet<string>;
	readonly indeterminate: boolean;
}
```

Suppression survives across passes while the caret stays on one line, so the arbiter still owns the rotation logic in `beginPass`. The detector computes, the arbiter decides what to keep.

**C7. Extract `editing/proposal-reconciler.ts`.**

Moves `correctProposal`, `correctDeps`, and `desiredDepPresence`. Pure, given a verdict and a `MarkerAccessorRegistry`. `LineWriteArbiter` keeps pass lifecycle, `LineEditor` decoration, and the query facade.

**C8. Collapse the five arbiter queries into one verdict read.**

`isSuppressed`, `isIndeterminate`, `getSuppressedDepIds`, `getFrozenDepsForIndeterminateLine`, and `getFrozenIdForCursorLine` become reads off the C6 verdict object. Fixes defect 2.4.

**C9. Split `EditorProcessor` into `link-pass.ts`, `cleanup-pass.ts`, and a thin orchestrator.**

`LinkPass` owns `runLinkPass` and the id-blocked skip rule. `CleanupPass` owns the three sub-passes plus the `currentBlock` and `lines` state. `EditorProcessor` keeps `processAllLines`: build the `CursorGuard`, call `beginPass`, run both passes, call `endPass`, restore the guard. Dependencies drop from six to three and the `max-params` disable goes away.

### Phase 4: composition root

**C10. Thin out `main.ts`.**

- `obsidian/indent-config-reader.ts` takes the `vault.getConfig` casting and the `useTab` / `tabSize` defaults.
- `obsidian/component-graph.ts` takes `buildComponents`.
- `main.ts` keeps Tasks plugin gating, `onload` / `onunload`, and `processActiveEditor`.

### Phase 5: verification

**C11. System test through the Obsidian CLI.**

C9 and C10 change wiring, which the project rules mark as requiring an end-to-end check. Build, copy `main.js` to `~/Dokumente/Obsidian Test Vault/.obsidian/plugins/tasks-auto-dependency-linker/`, reload the plugin, create a parent and child task list, trigger an editor change, confirm the `🆔` and `⛔` markers appear, unindent the child, trigger again, confirm cleanup, delete the test file. Update the architecture notes to describe the new layers.

## 5. Gate per commit

Each commit must pass `npm run check` end to end:

1. `npm run lint`
2. `tsc -noEmit -skipLibCheck`
3. `npm run typecheck:tests`
4. `npm run fta`, no file at or above 60
5. `npm test`, StrykerJS at 100 percent with zero survivors
6. `npm run build`

## 6. Risks and constraints

**Mutation testing drives the cost, not the code.** Stryker measures the project as a whole, so a class extracted out of `LineWriteArbiter` can reach 100 percent through the tests that already drive the arbiter facade. For C6 and C7, extract behaviour-preserving first, run Stryker, then write direct unit tests only where mutants survive. Writing a full parallel suite up front would duplicate most of the 1133 lines in `tests/unit/line-write-arbiter.test.ts` for nothing.

**C6 and C7 carry the highest blast radius.** The suppression logic decides whether a user's deletion sticks or gets silently undone on the next pass. Three earlier defects landed in exactly this area: the `setLine` return contract, a bare fragment on the cursor line steering a cleanup sub-pass onto the parent, and backspacing inside an id rewriting the parent every keystroke.

**Test folder layout stays as it is.** Commit `050ada8` settled the `tests/unit` and `tests/integration` split. New test files join that split rather than mirroring the new `src/` folders.

**Renames touch tests and docs.** `IndentationHandler` becomes `TaskLinker`, and `IdEngine` becomes `IdGenerator` plus `MarkerScanner`. Both `main.ts` and the test files carry the old names throughout, so each rename lands inside the commit that performs its split rather than as separate churn.

## 7. Settled decisions

These were answered while scoping the work. They are no longer open.

| Question | Answer |
|---|---|
| Scope | Class splits and folder layering together, the full eleven commits below. |
| Import direction enforcement | Add the ESLint rules. Ask for install permission at C3. |
| `LineWriteArbiter` split | In scope, across its own commits, each mutation-gated. |
| Design review before C6 | Yes. Blocking prerequisite, see Phase 3. |
| Names `TaskLinker`, `IdGenerator`, `MarkerScanner` | Approved. |

## 8. Before starting C1

Run `npm run check` against a clean tree to confirm the baseline is green. The language server currently reports errors against `tests/line-snapshot-store.test.ts` and `tests/cursor-guard.test.ts`, paths that commit `050ada8` moved into `tests/unit/`. A stale index explains it, but confirm that before attributing any later failure to this refactoring.

