# Test Suite Compression Plan

Source: `todo.txt` item "Compress tests into smaller number without loosing coverage +refactor @dev" (priority C).

This document is the working plan for an LLM agent executing the task across multiple sessions. Update the Progress Log at the bottom after each step instead of trusting memory across sessions.

## Goal

Reduce line count and duplicate structure in the five largest test files without lowering the Stryker mutation score. Hold the current 100% mutation score as a hard gate at every step, not just at the end.

## Non-goals

- Runtime is not the problem. `npm run test:unit` currently runs in 438 ms. Do not optimize for speed.
- Do not reduce the number of executed test cases as a goal in itself. Parameterization may increase the case count if it exposes rows that were previously implicit.
- Do not touch `src/` except where a Stryker mutant genuinely survives and forces a source-level fix (see AGENTS.md mutation testing rules).

## Baseline (measured before any change)

| Metric | Value |
|---|---|
| Source | 2900 lines / 20 files |
| Tests | 7875 lines / 20 `*.test.ts` files + 2 mocks |
| `it()` blocks in source | 484 |
| Runtime test cases | 700 |
| Vitest runtime | 438 ms |
| Files using `it.each` | 5 of 20 (task-parser, task-metadata-parser, id-engine, relationship-analyzer, indentation-handler) |

Target files (52% of the suite):

| File | Lines | Tests |
|---|---|---|
| `tests/line-write-arbiter.test.ts` | 1204 | 67 |
| `tests/editor-processor.test.ts` | 1170 | 57 |
| `tests/indentation-handler.test.ts` | 689 | 31 |
| `tests/main.test.ts` | 688 | 30 |
| `tests/marker-accessor.test.ts` | 303 | 55 |

## Safety net gaps found

Two gaps mean a large test refactor currently has no static check at all, only the runtime pass/fail of vitest and Stryker:

1. `tests` is listed in `eslint.config.mts:65` under `globalIgnores`. Test files get zero lint coverage.
2. `tsconfig.json:27-29` `include` is `["src/**/*.ts"]` only. Tests are not type-checked by `tsc` or by Stryker's `typescript-checker` (same tsconfig).

Step 1 below closes both gaps before any test content changes.

## Rules applied throughout

- Parameterize on data, never on control flow. A row that needs an `if` in the test body or a different assertion shape stays a standalone `it`.
- Name every parameterized row so a failure identifies which case broke.
- One commit per step. Gate each with `npm run test:unit` (fast feedback) then `npm test` (mutation, authoritative) before moving to the next step.
- Revert a step immediately if the mutation score moves, rather than patching forward.

## Step 0: Record the baseline

- Run `npm run test:unit`, then `npm test`. Record the mutation score and Stryker wall-clock time.
- Record `git rev-parse HEAD` as the revert anchor for this whole effort.

## Step 1: Test safety net (own commit)

1. Add `tsconfig.test.json` extending `tsconfig.json`. Include both `src/**/*.ts` and `tests/**/*.ts`. Add `"types": ["vitest/globals"]` if needed (verify against the installed vitest 3.2 docs, do not assume).
   Do **not** add `tests` to `tsconfig.json` itself. Stryker's `typescript-checker` reads that file; pulling tests into it would type-check tests against every mutant, slowing every mutation run and turning some kills into misreported `CompileError`s instead.
2. Add an npm script `typecheck:tests` running `tsc -noEmit -skipLibCheck -p tsconfig.test.json`.
3. Remove `"tests"` from `globalIgnores` in `eslint.config.mts`. Add a `files: ['tests/**/*.ts']` block.
   - Turn `max-lines-per-function` **off** for this block. Every `describe` callback is a function; the 50-line cap scoped to `src/` would fail on nearly every test file immediately.
   - Point the typed-linting parser options at `tsconfig.test.json` for this file set. Verify the exact `projectService`/`project` wiring against the installed `typescript-eslint` 8.35 docs before editing; do not guess the option shape.
4. Insert both new checks into `npm run check`, in the fast tier, before `npm test`: `lint` -> `tsc -p tsconfig.json` -> `typecheck:tests` -> `fta` -> `test` -> `build`.
5. Run both new checks against the current, unmodified test suite. Count the errors before editing anything.
   - Expect `noUncheckedIndexedAccess: true` (`tsconfig.json:14`) to be the largest source, firing on array-index reads like `lines[0]` throughout tests.
   - If the error count is large, do not mass-edit test files to satisfy it. Instead consider relaxing that one flag inside `tsconfig.test.json` only. Report the count and the choice before proceeding either way; this is a decision point, not an autopilot step.

Gate: `npm run check` green, committed, before touching any test file content.

## Step 2: Shared editor fixtures, repo-wide (own commit)

Six files each define their own editor mock, none shared:

- `tests/cursor-guard.test.ts:8` `createMockEditor(lines, anchor, head)`
- `tests/editor-processor.test.ts:23` `createMockEditor(lines, cursor)`
- `tests/indentation-handler.test.ts:12,31,43` `createMockEditor`, `createRefusingEditor`, `createCorrectingEditor`
- `tests/line-snapshot-store.test.ts:13` `createTarget(lines)`
- `tests/line-write-arbiter.test.ts:8,19` `createTarget(lines)`, `createArbiter()`
- `tests/obsidian-editor-adapter.test.ts:8` `createRealEditorMock(lines)`

1. Create `tests/fixtures/editor.ts`. One core builder taking `lines` plus optional cursor/selection, returning an object with a `setLine` spy. Keep `createRefusingEditor` and `createCorrectingEditor` as named wrappers around the core builder since those names encode behavioral intent, not just data shape.
2. Migrate smallest file first, verifying after each: `obsidian-editor-adapter` -> `line-snapshot-store` -> `cursor-guard` -> `indentation-handler` -> `line-write-arbiter` -> `editor-processor`.
3. Check before forcing a merge: `obsidian-editor-adapter.test.ts` mocks the real Obsidian `Editor`, not the narrow `LineEditor` port the other five use. If it does not fit the shared builder cleanly, leave it with its own mock. Forcing the fit would be worse than the duplication it removes.

Gate: full `npm test`. Score must be **identical** to baseline. This step changes no assertion, so any score movement means the fixture is not behaviorally equivalent to what it replaced, not an acceptable tradeoff.

## Step 3: Parameterization, one file per commit

### 3a. `marker-accessor.test.ts` (303 lines, 55 tests)

Five accessors (`Id`, `Due`, `Scheduled`, `Priority`, `Dependency`) each carry an identically shaped ~10-test block: exposes its marker type, reads the value, reads null when absent, applies to a line with none, replaces in place, removes it, plus `hasFragment` variants. Convert to a `describe.each` contract table over the four scalar accessors. `DependencyAccessor` is multi-value; it opts out of the rows that do not apply to it and keeps its own tests for the ones that do.

### 3b. `main.test.ts` (688 lines, 30 tests)

Three tables:
- `useTab` config pair, lines 116-180.
- Six vault event handlers, lines 254-382 (modify md/non-md, delete file/folder, rename file/folder).
- Three file-open handler tests, lines 384-431.

Leave untouched: lines 39-52, 67-75, 90-95, 209-211, 225-238, 478-507, 539-571, and especially 603-640, which asserts call ordering between `processAllLines` and a live cache refresh. Ordering assertions cannot be tabulated without losing what they test.

### 3c. `line-write-arbiter.test.ts` (1204 lines, 67 tests)

Three tables:
- Four bare-marker whitespace tests differing only by glyph, lines 92-153.
- Five `isIndeterminate` tests, lines 884-971.
- Six frozen-id/frozen-deps tests forming three mirrored pairs, lines 1052-1132.

Leave everything else, including the cold-arrival test at lines 41-48 and the sticky-suppression test at lines 757-780. Both guard specific mutants identified during prior mutation-testing work on this file (see codemem entries on line-write-arbiter races).

### 3d. `editor-processor.test.ts` (1170 lines, 57 tests)

Two tables:
- Cross-file dependency preservation, lines 475-596, varying `{idSet, vaultDepIds, expectIdRemoved}`.
- Orphan cleanup, lines 253-326.

Do not tabulate the "FINDING C" suite at lines 861-1008. Those six tests share setup but each asserts a distinct invariant across pass boundaries; collapsing them into a data table would make a failure unreadable without checking which invariant broke. They stay as six standalone tests.

Note: `createTestProcessor()` at lines 56-86 is already a single shared 31-line factory. There is no hidden constructor boilerplate to extract here, only test bodies to merge.

### 3e. `indentation-handler.test.ts` (689 lines, 31 blocks)

`removeStaleDeps` and `isIdReferencedAsDep` already use `it.each`. The remaining win is Step 2's shared fixture plus a local handler factory, and tabulating the six metadata-inheritance tests (lines 296-400+), which vary parent metadata against expected child metadata.

Gate for every file in this step: `npm run test:unit` first, then `npm test`. Commit only on an identical mutation score.

## Step 4: Evidence-based pruning (conservative)

Verify feasibility before investing in tooling, in this exact order:

1. Add `'json'` to the `reporters` array in `stryker.config.mjs`. Confirm `reports/mutation/mutation.json` is produced.
2. Set `disableBail: true` temporarily, re-run, and check whether `killedBy` arrays now contain more than one test id. The current report (pre-change) shows single-element `killedBy` arrays consistent with bail being enabled. Stryker's official docs describe `bail: 0` for the vitest runner when `disableBail` is true, but do not explicitly state that `killedBy` then lists every killer. If the disabled-bail report still shows single-element arrays, this step is not viable and Step 4 stops here; do not proceed to write a redundancy script against data that cannot support it. Expect roughly +8% runtime per Stryker's own documented benchmark.
3. Confirm the top-level `testFiles` map exists in the JSON report and resolves numeric test ids to names. Not yet confirmed as of this writing.

If all three checks pass, analyze offline (write results to a file, never dump the report to stdout; it is 1.5 MB and floods an LLM context):

- `must-keep`: every test that is the sole killer of at least one mutant.
- `candidates`: only tests whose killed-mutant set is a **strict subset of a single other test's** killed-mutant set. Nothing else qualifies.

The narrow definition of `candidates` matters. Redundancy here is a set-cover problem: two tests can each look individually redundant while being jointly necessary, and deleting both would let a mutant survive silently until the next unrelated change exposes it. Strict single-test domination is the only per-test judgment safe to make without solving the full cover.

Delete in small batches. Run `npm test` after each batch. Revert any batch that moves the score, do not investigate first. Restore `disableBail` to its default (`false`) once the analysis is done; keep the json reporter enabled going forward since it is cheap and useful for future rounds.

Expect few deletions. A dominated test measured against today's mutants may still document a scenario that catches tomorrow's bug; that tradeoff is the intended effect of choosing the conservative approach over a greedy minimal covering set.

## Step 5: Close out

1. `npm run check` green end to end.
2. Mark the todo.sh item done: `todo.sh do <line>` for the "Compress tests" item, then re-check `todo.sh -p list`.
3. Write a codemem entry covering: the fixtures module location and its API, why `tsconfig.test.json` stays separate from `tsconfig.json`, and the Step 4 findings (whether pruning was viable, and if not, why).
4. No Obsidian CLI smoke test is required for this task by itself: the changes are confined to `tests/` and config files, with zero production runtime behavior change. The one exception is if a surviving mutant forces an actual `src/` fix during Step 3; in that case the AGENTS.md system-test rule for architectural changes applies and a live-vault smoke test becomes mandatory before committing that particular fix.

## Expected outcome

| | Baseline | Target |
|---|---|---|
| 5 target files, combined lines | 4054 | ~2600-3000 |
| `marker-accessor.test.ts` | 303 | ~150 |
| Mutation score | current | identical |
| Runtime test cases | 700 | may increase |

"Smaller number of tests" and "not losing coverage" pull in opposite directions. Step 3 resolves the tension by reducing *source* `it()` blocks while holding or raising the number of *executed* cases. Case count is deliberately not a metric to minimize.

Treat the 45-50% compression estimate produced by earlier research subagents as directional only. One of their two headline claims (~600-700 lines of "hidden" constructor boilerplate in `editor-processor.test.ts`) was checked directly against the file and found false; the factory already exists as a single 31-line function.

## Risks

1. Step 1 turns on two previously-absent checks over 7875 unchecked lines at once. The explicit decision point in Step 1.5 exists so a large backlog gets reported and decided on, not silently patched.
2. Stryker's per-file wall-clock time is not yet measured (see Step 0). If per-file gating in Step 3 proves too slow, use `stryker run --incremental` between individual file changes and reserve full runs for step boundaries.
3. `disableBail` behavior for `killedBy` is unverified against official docs beyond the `bail: 0` mechanism. Step 4 tests this cheaply first and aborts cleanly if it does not hold.
4. One commit per step keeps every step bisectable and revertable independently.

## Progress log

Update after completing each step. Do not rely on conversation history surviving between sessions; this file is the source of truth for where the effort stands.

- [x] Step 0: baseline recorded. Anchor commit `b0e5cff`. 700 tests in ~445 ms. Mutation score 100.00% (699 killed, 8 timeout, 0 survived, 287 compile errors) in 2m6s. All 20 source files at 100.00%.
- [x] Step 1: safety net. Committed as `92f6cbb`. Landed as `tests/tsconfig.json`, not the root `tsconfig.test.json` the plan called for: typescript-eslint's `projectService` reads only files literally named `tsconfig.json` or `jsconfig.json` ([docs](https://typescript-eslint.io/troubleshooting/typed-linting#id-like-to-use-tsconfigsjson-files-other-than-tsconfigjsons-for-project-service-type-information)), so a differently-named root file would have been invisible to ESLint. A `tests/tsconfig.json` satisfies both `projectService` and the requirement to keep tests out of the root config Stryker reads.
  - Step 1.5 decision point: `typecheck:tests` reported zero errors, so the feared `noUncheckedIndexedAccess` backlog did not exist and no compiler flag was relaxed. ESLint reported 342 errors, 337 of them `no-unsafe-*`/`unbound-method` in `main.test.ts` and `plugin-triggers.test.ts`, all traceable to their `type PluginInternals = any` aliases. Following the precedent in obsidian-tasks and obsidian-test-mocks, and the "When Not To Use It" note on the `no-unsafe-member-access` rule page, those four rules are off for the `tests/**/*.ts` glob. Two rules were kept stricter than that precedent: `no-explicit-any` stays on, so the existing per-site disable comments keep documenting intent, and `no-unnecessary-type-assertion` stays on, with its 5 hits fixed by deleting dead non-null assertions in `editor-processor.test.ts`.
  - Verification: lint 342 errors down to 0, both type-checks clean, 700/700 tests, mutation score 100.00% with 0 survived, unchanged from baseline.
- [x] Step 2: shared editor fixtures. `tests/fixtures/editor.ts` (142 lines) exports `createLineEditor`, `createRefusingEditor`, `createCorrectingEditor`, `createEditor` and the `OFF_SCREEN_CURSOR` constant. Five files migrated; `obsidian-editor-adapter.test.ts` kept its own mock via the escape hatch, since it stands in for Obsidian's real `Editor` whose `setLine` returns `void`.
  - Two shapes rather than one: `LineEditorFixture` and `EditorFixture`, mirroring the `LineEditor` and `EditorLike` ports. A test that only needs line access gets an object with no `getCursor`, so a production class that starts reaching for the caret cannot pick it up from an over-provisioned fixture.
  - One deliberate behaviour change: `getLine` now throws a `RangeError` on an out-of-range index everywhere. Two of the six mocks already did; the other four returned `undefined`. Throwing can only kill a mutant, never un-kill one, so it was safe to unify under the identical-score gate.
  - Verification: 700/700 tests, lint clean, both type-checks clean, mutation score 100.00% with 699 killed / 8 timeout / 0 survived, matching the Step 0 baseline exactly. Net 137 lines removed across the five files.
- [x] Step 3a: marker-accessor.test.ts. 303 -> 288 lines, 55 cases unchanged,
  mutation 100.00% / 699 killed / 8 timeout / 0 survived / 287 errors, an exact
  match to the baseline. Two `describe.each` tables replaced the repeated
  per-accessor blocks: `scalarAccessorContracts` (type, read, read-null, apply,
  replace, remove for Id/Due/Scheduled/Priority) and `fragmentAccessorContracts`
  (four `hasFragment` rows for Id/Due/Scheduled). Three columns were dropped
  from the scalar table because they carried the same literal in every row:
  `applyBase` and `removeResult` are now the shared `BARE_TASK` constant, and
  `removeLine` folded into `markedLine`, since reading a value out of a line and
  stripping it back off are inverses over the same input.

  Four blocks stayed as standalone `it()`s. `PriorityAccessor hasFragment` (2
  tests) has no incomplete or bare state to tabulate, because a priority glyph
  is a single code point. `DependencyAccessor` (13 tests) is multi-value: its
  `read()` returns a `Set` and its `apply()`/`remove()` take an extra id
  argument, so the scalar row shape does not describe it. `MarkerAccessorRegistry`
  (4 tests) asserts composition and instance sharing, not an accessor contract.

  The ~150-line target in this step was not reachable and the estimate was
  wrong, not the execution. Of the 288 lines, roughly 130 are irreducible:
  13 import lines, the 13 DependencyAccessor `hasFragment` edge cases (each a
  distinct one-line assertion about comma placement), the 4 registry tests, and
  the 2 priority fragment tests. The remaining ~150 lines carry 36 executed
  cases through the two tables, which is the compression the step was after.
- [x] Step 3b: main.test.ts. 688 -> 642 lines, 30 cases unchanged, mutation
      100.00% / 699 killed / 8 timeout / 0 survived / 287 errors in 2m8s, an
      exact baseline match. Three groups were offered for tabulation and two
      and a half landed: the `useTab` config pair, the two vault modify tests,
      the two vault delete tests, and the three file-open tests. The two vault
      rename tests refused to tabulate and stayed standalone, because the
      TFile case asserts on `idCache.getAll().has(id)` while the TFolder case
      asserts on a `buildFromFiles` spy's call arguments. That is two different
      assertion shapes, not one shape over two data rows, so the plan's
      data-not-control-flow rule keeps them apart.
      Found while reviewing the diff: main.test.ts still hand-rolls eight
      inline editor mocks. Step 2's survey missed them because it looked for
      named factories and these are anonymous object literals. Migrating them
      to `tests/fixtures/editor.ts` is a Step 2 concern, so it gets its own
      commit rather than riding along here.
- [x] Step 2 follow-up: the eight inline editor mocks in main.test.ts.
      642 -> 599 lines, 30 cases unchanged, mutation 100.00% / 700 killed /
      7 timeout / 0 survived / 287 errors in 2m8s. All eight sites took
      `createEditor(lines, { line: 0, ch: 0 })` without a single revert.
      The risk going in was that the inline mocks used `setLine: vi.fn()`,
      which records a write but never applies it, while `createEditor` writes
      through to the backing array. Since the processing pipeline reads each
      line again on later passes, a write-through editor can feed different
      text back to production code. No test turned out to depend on that, so
      the rule "if a test fails, revert that one site and report it, never
      adjust the assertion" was never invoked. Four sites keep an extra
      `getValue` spy through object spread, because `getValue` is not part of
      the `EditorLike` port and the fixture rightly does not provide it.
- [x] Step 3c: line-write-arbiter.test.ts. 1193 -> 1133 lines, 67 cases
      unchanged, mutation 100.00% / 699 killed / 8 timeout / 0 survived /
      287 errors in 2m8s, an exact baseline match. Two of the three offered
      groups landed and the third was correctly refused.
      The bare-marker whitespace group gave up three rows, not four: the
      dependency case asserts `getSuppressedDepIds().has('abc123')` while the
      id, due and scheduled cases assert `isSuppressed(0, MarkerType.X)`.
      Different method, different return type, so it stayed standalone.
      The `isIndeterminate` group gave up six rows over columns `name`, `line`
      and `expected`. The seventh candidate stayed standalone because it feeds
      two lines and asserts twice, once per line index. An extra assertion is
      a different shape, not a different data value.
      The frozen-id and frozen-deps group was refused whole. The two halves
      call `getFrozenDepsForIndeterminateLine` returning a `Set` and
      `getFrozenIdForCursorLine` returning `string | null`, so a joint table
      needs a function column and a union-typed expectation, which is control
      flow wearing a data costume. Within each half the three tests do not
      match either: two run a two-pass setup with an `endPass()` in between
      and the third runs a single pass with no prior snapshot, so a row would
      have to conditionally skip the first pass.
- [x] Step 3d: editor-processor.test.ts. 1144 -> 1122 lines, 57 -> 56 cases
      Mutation gate 100.00%, 699 killed, 8 timeout, 0 survived, 0 no cov, 287 errors,
      real 2m7,990s. Exact baseline match. Output in /tmp/tadl-step3d-mutation.txt.
      Four small tables landed, none of the big ones the plan expected. The
      cross-file vault dep ID group yielded exactly one pair (empty vaultDepIds set
      versus the argument omitted, which createTestProcessor treats identically via
      `options?.vaultDepIds`); the other five tests each assert a different number of
      markers with a different matcher mix, so they stayed standalone. The orphan
      cleanup group yielded nothing tabulatable: the tests at the old lines 249 and
      263 look like a pair but their third assertion flips between toContain and
      not.toContain, and the one asserting setLine was never called is a different
      shape outright. Two bonus pairs came out of `deleted child cleanup` instead:
      two single-line docs whose stray dependency is stripped whole, and two dangling
      dependency docs differing only in which line carries the marker.
      One test was deleted rather than tabulated. `keeps 🆔 when another line still
      has ⛔ referencing it` and `does not remove ⛔ that corresponds to a valid
      child` had byte-identical setup and the same two assertions in reverse order,
      written once from the child's side and once from the parent's. A table over
      them carried a name column and nothing else, which is a duplicate wearing a
      table as a disguise. Neither can kill a mutant the other misses, so they are
      now one test titled `keeps a matching 🆔 and ⛔ pair intact on both the child
      and the parent`, with a comment recording why. This is the strongest form of
      the Step 4 domination argument, proven by inspection instead of by report
      analysis, and the mutation gate confirmed it costs nothing.
      The FINDING C suite, the C3 and Finding B regressions, the arbiter integration
      block and the deletion fuzz suite were never touched.
- [x] Step 3e: indentation-handler.test.ts. 647 -> 625 lines, 39 cases
      Mutation gate 100.00%, 699 killed, 8 timeout, 0 survived, 0 no cov, 287 errors,
      real 2m7,696s. Exact baseline match. Output in /tmp/tadl-step3e-mutation.txt.
      The plan's expectation held: the local handler factory was the bigger win.
      `createHandler()` now owns the four-collaborator construction and replaced 18
      literal `new IndentationHandler(...)` call sites across `processLine` and
      `metadata inheritance`. It was deliberately not pushed into the two existing
      it.each blocks, the two sync-cache tests that build a different inheritor, the
      already-local `seededHandler`, or the four Finding B tests.
      One table landed, `parentValueChangeCases`, four rows over columns child,
      priorParent, newParent, expectedContain, expectedNotContain. Two columns were
      cut from the first draft: the child line was carried twice, once for the prior
      snapshot and once for the current document, and it was the same literal in both
      places in all four rows, which is the whole point of the group (only the parent
      moved). The explicit generic annotation on it.each went too, since the array
      literal infers.
      The metadata inheritance group refused entirely: its seven tests make 1, 3, 3,
      3, 4 and 3 assertions respectively and one runs processLine twice, so no two
      share a shape. Three of the seven propagation tests stayed standalone for the
      same reason: one has no not.toContain counterpart, two assert toBe against the
      whole child line. The two sync cache tests differ by editor fixture, refusing
      versus accepting, which is behaviour and not data.
- [x] Step 4: evidence-based pruning. Verdict: prune nothing. No test deleted.
      All three preconditions passed. The `json` reporter writes
      reports/mutation/mutation.json (1.4 MB, already covered by the `reports/`
      entry in .gitignore). With `disableBail: true` the killedBy arrays stopped
      being single-element and spread from 1 to 191 entries, so bail really had
      been hiding the data. The top-level testFiles map resolved all 696 recorded
      test ids to names across 20 files. Runtime went 2m8 to 2m39, +24% rather
      than the +8% the plan guessed. Output in /tmp/tadl-step4-mutation.txt.
      The analysis then refuted the plan's own criterion. 73 tests are strictly
      dominated by exactly one other test. Reading them shows kill-set domination
      measures how much source a test reaches, not whether it is redundant. All 36
      cross-file dominations run from a narrow unit suite to a broad integration
      suite with no counterexample: relationship-analyzer to editor-processor 6x,
      plugin-triggers to main 5x, indentation-handler to editor-processor 4x.
      Deleting the dominated side would delete unit tests and keep integration
      tests, which inverts the pyramid and costs diagnostic precision. The 37
      same-file candidates are no safer: they include the only direct test of
      TaskParser DEFAULT_CONFIG and the cold-arrival trailing-space test, which is
      the regression guard for the user-reported bug in codemem 589.
      Two further findings, both from data the plan did not anticipate:
      93 groups of tests share a byte-identical kill set, for example 14 tests
      covering ID_REGEX against uppercase, hyphens, underscores, 5-char and 10-char
      ids that all hit the same 3 mutants. Each encodes a separate clause of the
      Tasks-plugin id contract in AGENTS.md; Stryker simply never generates a
      mutant that separates them. Kill-set identity is not duplication.
      63 tests kill zero mutants, and that is also not dead weight. For
      `removeDueDate returns the line unchanged when no due date is present` every
      mutant on the null guard comes back CompileError, because strictNullChecks
      makes match.index unreachable-typed once the guard is mutated away. The type
      checker absorbs those mutants, so no test can ever be credited with them.
      Conclusion recorded for future readers: the only reliable duplicate detector
      in this suite is reading setup and assertions, which is how the single real
      duplicate was found and merged in Step 3d. The json reporter stays in
      stryker.config.mjs with a comment on how to re-run this analysis;
      disableBail was reverted to its default.
- [x] Step 4b (added by the user after seeing the Step 4 verdict): split the suite
      into tests/unit and tests/integration, one test file per source file.
      Classification rule, derived from the mutation report rather than guessed:
      unit means the file's subject is one source module and every production
      collaborator it constructs belongs to the stateless text and derivation layer
      (TaskParser, TaskMetadataParser, LineSplicer, the marker accessors,
      RelationshipAnalyzer). Integration means the subject's job is to orchestrate,
      so the test wires up at least one stateful production collaborator.
      Statelessness was verified per module, not assumed: RelationshipAnalyzer
      exposes only buildRelationshipMap, findParentTask, getDesiredDepsForParent
      and identifyListBlocks, while MetadataSyncCache exposes get, set, seedFile,
      seedValue, pruneFile, pruneExactPath, updateForFile and buildFromFiles.
      Self-share alone was rejected as the rule because it would have filed
      marker-accessor.test.ts as integration at 23.8%; the accessors are thin
      facades, so their kills land in the parsers they delegate to.
      The grouping requirement needed no merges. Every source module with mutants
      already had exactly one same-named test file. src/types.ts has no test file
      because it declares only interfaces and produces no mutants.
      marker-invariants.test.ts is the one file with no same-named module: it is a
      property suite over every accessor at 0% self-share, so it stays its own file
      under integration rather than being folded into marker-accessor.test.ts.
      Result: 14 files under tests/unit (task-parser, task-metadata-parser,
      line-splicer, marker-accessor, utils, cursor-guard, cursor-line-watcher,
      obsidian-editor-adapter, plugin-triggers, id-engine, relationship-analyzer,
      line-snapshot-store, line-write-arbiter, metadata-sync-cache) and 6 under
      tests/integration (main, editor-processor, indentation-handler,
      cache-coordinator, metadata-inheritor, marker-invariants). tests/fixtures and
      tests/__mocks__ stayed where they were, so their own imports did not move.
      Only import specifiers changed, 77 of them across three prefix classes, and
      the diff was checked to contain zero non-import lines. No config edit was
      needed: vitest includes tests/**, eslint lints tests/**, and
      tests/tsconfig.json includes **/*.ts, all of which already recurse.
      Mutation gate 100.00%, 699 killed, 8 timeout, 0 survived, 0 no cov, 287
      errors, real 2m9,455s. Exact baseline match. Output in
      /tmp/tadl-step4b-mutation.txt.
- [x] Step 5: close out. `npm run check` exits 0 end to end in one run: lint, tsc
      over src, tsc over tests/tsconfig.json, fta, 699 vitest tests, stryker at
      100.00% with 0 survived, and the production build. real 2m13,084s, output in
      /tmp/tadl-step5-check.txt. todo.sh item 4 (Compress tests) marked done and
      archived. Codemem entry 729 records the fixture API, why the test tsconfig
      cannot live at the repo root, the Step 4 rejection and its evidence, and the
      unit versus integration rule with the self-share alternative that was
      rejected. No Obsidian CLI smoke test was needed: no mutant survived, so
      src/ was never touched by this effort.

## Results

Written after the work finished, so a later reader does not have to reconstruct
the outcome from the progress log above.

### The headline target was missed

The plan projected the five biggest test files falling from 4054 lines to roughly
2600 to 3000. They landed at 3767. Across the whole suite the change is 7716 lines
to 7418, plus a new 142 line fixture, so 156 lines net, about 2 percent. Executed
tests went from 700 to 699.

The projection was wrong, not the execution. Roughly half the groups this plan
nominated for tabulation turned out to differ in assertion shape rather than in
data, and refusing them was correct under the plan's own rule. The lesson is about
estimating: counting visually similar blocks in a test file overestimates how much
of that similarity is data. Only reading the assertions tells you, and that read
cannot be done from a line count.

Because of this, the todo item that started the work ("Compress tests into smaller
number without loosing coverage") is closed as investigated rather than as
delivered. Compression at any meaningful scale is not safely available in this
suite. One genuine duplicate was found and merged, in Step 3d, by reading code.

### What actually carried the value

Ranked, so a later effort spends its time in the right place:

1. Step 1, linting and type checking the tests. Before it the whole `tests/` tree
   sat in eslint's `globalIgnores` and in no tsconfig at all, so it had zero static
   checking. That gap is now closed inside `npm run check`.
2. The shared editor fixture. Fourteen hand written editor mocks with three
   different out of range behaviours became one builder with one behaviour.
3. The Step 4 negative finding below, which is the only artifact here that answers
   a question that would otherwise get asked again.
4. The unit and integration split, whose main payoff is triage during the coupling
   refactor queued next: a red unit test means a module contract broke, a red
   integration test means wiring broke.
5. The tabulation, which was this plan's centrepiece and delivered the least.

### Do not re-run the Step 4 pruning idea

Deleting tests by kill set dominance does not work here, and the evidence is in the
Step 4 progress entry. In short: dominance measures how much source a test reaches,
not whether it is redundant. All 36 cross file cases pointed from a narrow unit
suite to a broad integration suite, so acting on them would delete unit tests and
keep integration tests. Dominance is also computed against today's mutants only,
which is why it flags regression guards such as the trailing space guard from the
bug in codemem 589: no mutant exists for a bug that was already fixed.

### The fixture's RangeError is deliberate and matches production

`tests/fixtures/editor.ts` throws `RangeError` when `getLine` is called out of
range. Four of the six mocks it replaced returned `undefined` instead, so this is a
real behaviour change and worth recording as verified rather than assumed:

- `src/types.ts` declares `getLine(n: number): string`, so the port never admits
  `undefined`.
- Obsidian declares the same, `abstract getLine(line: number): string` in
  `obsidian.d.ts`.
- CodeMirror 6, which backs Obsidian's editor, throws
  `RangeError("Invalid line number ...")` from `Text.line(n)`.
- All 14 `getLine` call sites in `src/` are either bounded by a
  `for (i < lineCount())` loop or guarded by an explicit `>= lineCount()` check
  (`line-write-arbiter.ts` lines 112 and 136, `cursor-guard.ts` line 65).

So the throw matches production and the four mocks returning `undefined` were the
inaccurate ones. No production path tolerates `undefined` from `getLine`, because
no production path can reach an out of range index.
