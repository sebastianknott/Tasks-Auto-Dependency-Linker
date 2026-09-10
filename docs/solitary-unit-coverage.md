# Solitary unit coverage

Plan document for the test policy settled after the layer restructure. It records the measurement, the rule, the enforcement mechanism, and the commit sequence. It carries no task state.

Status: planned, not started. Measured against the tip of the restructure work, 702 tests, 1011 mutants, full-suite mutation score 100.00.

## 1. The policy

Two statements, both non-negotiable.

1. Every source file reaches 100 percent mutation score **from the unit tests alone**.
2. Integration tests may test the interaction between classes, and nothing else. A test that asserts the behaviour of one class belongs in `tests/unit/`.

The first statement is worded around mutation score, not line coverage. Line coverage says a statement ran; it does not say an assertion would notice if that statement changed. This project already treats mutation score as the truth metric, so the policy inherits that metric rather than introducing a weaker one.

The second statement is what makes the first honest. As long as a class can borrow coverage from a test that drives six other classes, nobody can tell which class the test actually pins.

## 2. Baseline measurement

The full suite scores 100.00. The unit suite alone scores **78.16**.

The measurement ran Stryker against a vitest config restricted to `tests/unit/**`, with the break threshold lifted so the run would complete. Both temporary files were deleted afterwards.

| | full suite | `tests/unit/` only |
|---|---|---|
| mutation score | 100.00 | 78.16 |
| killed | 697 | 545 |
| timeouts | 8 | 6 |
| survived | 0 | 8 |
| no coverage | 0 | 146 |
| compile errors, excluded from the score | 306 | 306 |

Nine source files sit at zero percent without the integration suite. They account for 136 of the 146 uncovered mutants:

| File | uncovered mutants |
|---|---|
| `src/processing/cleanup-pass.ts` | 50 |
| `src/linking/metadata-inheritor.ts` | 21 |
| `src/linking/task-linker.ts` | 20 |
| `src/processing/link-pass.ts` | 17 |
| `src/main.ts` | 17 |
| `src/cache/cache-coordinator.ts` | 8 |
| `src/processing/editor-processor.ts` | 1 |
| `src/obsidian/component-graph.ts` | 1 |
| `src/obsidian/indent-config-reader.ts` | 1 |

Three files that already own unit tests still lose mutants once the integration suite is removed, which means their unit suites were quietly leaning on it:

| File | full suite | unit only | survivors |
|---|---|---|---|
| `src/editing/line-snapshot-store.ts` | 100 | 86.54 | 7 |
| `src/editing/line-write-arbiter.ts` | 100 | 93.88 | 3 |
| `src/linking/dependency-cleaner.ts` | 100 | 61.90 | not counted separately |

Runtime does not constrain any decision here. The whole 702-test suite runs in 636 ms, of which the six integration files take roughly 277 ms.

**Do not try to derive this from the Stryker JSON report.** `stryker.config.mjs` leaves `disableBail` at its default, so `killedBy` names only the first test that killed each mutant. Tallying that field produces a unit-versus-integration split that is a pure test-ordering artifact. The exclusion experiment above is the only valid measurement.

## 3. Solitary by default

Every collaborator gets a test double. The one exception is a class whose double would cost more than the class it replaces, and the audit below found exactly one such case in the whole codebase.

The restructure paid off here. Each class now calls between one and four methods on each of its collaborators, so a hand-written stub is a few lines.

| Subject under test | Collaborator | Methods the subject actually calls | Double |
|---|---|---|---|
| `CleanupPass` | `DependencyCleaner` | `removeStaleDeps`, `removeDanglingDeps`, `isIdReferencedAsDep` | stub |
| | `TaskParser` | `getTaskId`, `removeIdFromLine` | stub |
| | `RelationshipAnalyzer` | `identifyListBlocks`, `buildRelationshipMap`, `getDesiredDepsForParent` | stub |
| | `MarkerCacheLike` x2 | `getAll`, `getAllExcluding` | stub, pattern already exists |
| | `LineWriteArbiter` | `getSuppressedDepIds`, `getFrozenDepsForIndeterminateLine`, `getFrozenIdForCursorLine` | stub |
| | `LineEditor` | `lineCount`, `getLine`, `setLine` | `createLineEditor` fixture |
| `LinkPass` | `TaskLinker` | `prepareForLinkPass`, `processLine` | stub |
| | `TaskParser` | `getTaskId` | stub |
| | `MarkerCacheLike` | `getAll` | stub |
| | `LineWriteArbiter` | `blocksIdMinting` | stub |
| `TaskLinker` | `RelationshipAnalyzer` | `findParentTask` | stub |
| | `TaskParser` | `getTaskId`, `addIdToLine`, `addDependencyToLine`, `getTaskDependencies` | stub |
| | `IdGenerator` | `generateUniqueId` | stub |
| | `MetadataInheritor` | `syncFromParent`, `confirmWrite` | stub |
| `MetadataInheritor` | `MarkerAccessorRegistry` | `.inheritable`, then `hasFragment`, `read`, `apply`, `type` per accessor | fake accessor array, see 3.2 |
| | `MetadataSyncCache` | `get`, `set` | stub |
| `CacheCoordinator` | `IdCache`, `DepCache` | `buildFromFiles`, `updateForFile` | stub |
| | `MetadataSyncCache` | `buildFromFiles`, `updateForFile`, `pruneFile`, `pruneExactPath` | stub |
| | `VaultReader` | `cachedRead`, `getMarkdownFiles` | stub |
| `EditorProcessor` | `LinkPass`, `CleanupPass`, `LineWriteArbiter`, `CursorGuard` | `run`, `run`, `beginPass`/`endPass`, `restore` | stub, `CursorGuard` via module mock |
| `IndentConfigReader` | `Vault` | `getConfig` | stub |
| `TasksAutoDependencyLinker` | `ComponentGraph`, `IndentConfigReader`, `PluginTriggers`, `Debounce`, `CursorLineWatcher` | constructed internally | module mock, see 3.3 |

### 3.1 The single exception

`ComponentGraph` is the production wiring and nothing else: one constructor, sixteen `new` expressions, cyclomatic complexity 1, one mutant. Replacing its sixteen collaborators with doubles would produce a test that asserts the test's own wiring. Its test asserts instead that each of the six published fields holds an instance of the expected class. That is a sociable test by construction, and it is the correct one, because the class under test *is* the composition.

No other class qualifies for the exception.

### 3.2 Fake marker accessors

`MetadataInheritor` reads `registry.inheritable` and then calls four members on each accessor. Building the real registry drags in `TaskParser` and `TaskMetadataParser` along with their regexes. Instead, hand-roll an array holding one or two fake accessors:

```ts
function fakeAccessor(type: MarkerType, overrides: Partial<MarkerAccessor> = {}): MarkerAccessor {
	return {
		type,
		read: vi.fn(() => null),
		apply: vi.fn((line: string) => line),
		remove: vi.fn((line: string) => line),
		hasFragment: vi.fn(() => false),
		...overrides,
	} as unknown as MarkerAccessor;
}
```

Pass `{ inheritable: [fakeAccessor(MarkerType.Due)] } as unknown as MarkerAccessorRegistry`. One accessor is enough for most cases; add a second only when the test is about iteration across fields.

### 3.3 Mocking classes that the subject constructs itself

`main.ts` builds `IndentConfigReader`, `ComponentGraph`, `Debounce`, `CursorLineWatcher` and `PluginTriggers` inside `onload()`, so constructor injection cannot reach them. Use vitest module mocking, which needs no production change:

```ts
vi.mock('../../src/obsidian/component-graph', () => ({
	ComponentGraph: vi.fn(() => ({
		idCache: {}, depCache: {}, syncCache: {},
		coordinator: { updateFromLiveContent: vi.fn() },
		arbiter: {},
		processor: { processAllLines: vi.fn() },
	})),
}));
```

The same applies to `EditorProcessor`, which does `new CursorGuard(editor)` inside `processAllLines`.

Do not refactor production code to make these injectable. The wiring is deliberate, a factory parameter would exist only for the tests, and the module mock costs less than the indirection.

### 3.4 Stub style

Drive stubs from explicit per-test data, not from a reimplementation of the collaborator.

```ts
// Good: the test states what the parser sees.
const ids = new Map([['\t- [ ] Child 🆔 abc123', 'abc123']]);
const parser = { getTaskId: vi.fn((l: string) => ids.get(l) ?? null) };

// Bad: the stub reimplements the regex, so the test now pins TaskParser too.
const parser = { getTaskId: vi.fn((l: string) => /🆔 (\w+)/.exec(l)?.[1] ?? null) };
```

Assert on the calls the subject made to its collaborators and on what it wrote through `LineEditor.setLine`. Do not assert on a string the test re-derived with the same logic the subject uses.

## 4. Enforcement

Writing the tests once is not the deliverable. A gate that fails the build when the invariant breaks is the deliverable. Without it, the next feature reintroduces the gap and nobody notices for a year.

### 4.1 Two committed config files

`vitest.unit.config.ts` mirrors `vitest.config.ts` and overrides one key:

```ts
test: { include: ['tests/unit/**/*.{test,spec}.ts'] }
```

`stryker.unit.mjs` spreads the base config and repoints the runner at it:

```js
import base from './stryker.config.mjs';

export default {
	...base,
	vitest: { ...base.vitest, configFile: 'vitest.unit.config.ts' },
	thresholds: { ...base.thresholds, break: 78 },
	incrementalFile: 'reports/stryker-incremental-unit.json',
};
```

The `break` value is a ratchet. Every commit in section 5 raises it to the score that commit achieved, and never lowers it. The final commit sets it to 100.

Give `stryker.unit.mjs` its own `incrementalFile`, otherwise the unit run and the full run overwrite each other's incremental state and both start reporting nonsense.

### 4.2 Scripts

```json
"test:mutation:unit": "stryker run stryker.unit.mjs",
"test:mutation:unit:incremental": "stryker run stryker.unit.mjs --incremental",
```

Every tool in this project is reachable through a named script, and the CI entry point is `npm run check`. A gate invoked only by hand is not a gate.

### 4.3 The unit gate subsumes the full gate

Adding tests can only kill more mutants, never fewer. The unit suite is a subset of the full suite, so the full-suite score is always greater than or equal to the unit-only score. Once the unit gate holds at 100, the full-suite score is 100 by construction and running Stryker twice measures the same number twice.

So the final wiring runs the mutation gate once, against the unit suite, while still executing every test:

```json
"test": "vitest run && npm run test:mutation:unit",
```

`vitest run` keeps the integration suite honest. A mutant that only an integration test kills shows up as a survivor in the unit run, which is exactly the policy violation the gate exists to catch.

Keep `test:mutation` pointing at the full-suite config. It stays useful for diagnosing a survivor, because a mutant that survives the unit run but dies in the full run names the integration test that is doing a unit test's job.

### 4.4 Prove the gate bites

Editing a config that enforces an invariant is itself test-driven work. A rewritten gate that silently catches less is worse than no rewrite.

After adding the two config files, and again after any later change to them:

1. Delete or `it.skip` one assertion-carrying unit test, for example a case in `tests/unit/id-generator.test.ts`.
2. Run `npm run test:mutation:unit`. Confirm it reports survivors and exits non-zero.
3. Restore the test. Confirm the run is green again.

If step 2 passes, the gate is a no-op and the whole plan is decorative. Find out why before continuing.

### 4.5 The leakage probe

The gate in 4.1 catches under-testing. The opposite failure, a unit test that quietly exercises its dependencies, needs its own probe.

For a test file `T` whose subject is `S`, mutate everything except `S` and run only `T`. A solitary test kills nothing.

```bash
# Example: does tests/unit/cleanup-pass.test.ts reach into TaskParser?
npx stryker run stryker.unit.mjs \
  --mutate 'src/parsing/task-parser.ts' \
  --reporters clear-text \
  --logLevel warn
```

with `vitest.unit.config.ts` temporarily narrowed to `include: ['tests/unit/cleanup-pass.test.ts']`. Any killed mutant names a dependency the test is pinning by accident.

Run the probe once per new test file, against the two or three collaborators most likely to leak, and record the result in the commit message. Do not commit the narrowed vitest config.

`-m` also accepts a mutation range as `path:startLine-endLine`, which is useful when only one method of a collaborator is suspect.

## 5. Commit sequence

Order the work so the project never drops below its current guarantees. Unit tests land before the integration tests they replace are touched, and the ratchet in `stryker.unit.mjs` rises with each commit.

Each commit states its measured unit-only score in the message.

### Phase 1: the gate

**T1. Add the unit-only mutation gate.**

`vitest.unit.config.ts`, `stryker.unit.mjs` with `break: 78`, the two scripts from 4.2. Do not touch `npm run check` yet. Run the 4.4 proof and record the result.

### Phase 2: reclassification, no behaviour change

**T2. Move four single-class suites into `tests/unit/`.**

`git mv` only, no content edits. All four import solely from `../../src/...`, which resolves identically at both depths, so nothing needs rewriting.

- `tests/integration/metadata-inheritor.test.ts`, 22 tests, 37 outcome assertions, 0 interaction assertions
- `tests/integration/cache-coordinator.test.ts`, 11 tests, 18 outcome assertions, 1 interaction assertion
- `tests/integration/task-linker.test.ts`, 28 tests, 51 outcome assertions, 2 interaction assertions
- `tests/integration/marker-invariants.test.ts`, 27 tests, property suite over `MarkerAccessorRegistry` and `LineSnapshotStore`, no orchestration

These suites still use real collaborators after the move. Phase 3 makes them solitary. Splitting the move from the rewrite keeps a large diff out of a commit that also changes assertions.

Expected jump: `metadata-inheritor.ts`, `task-linker.ts` and `cache-coordinator.ts` leave the zero-coverage list, `line-snapshot-store.ts` loses its 7 survivors. Raise the ratchet to the measured value.

### Phase 3: make the moved suites solitary

One commit each, smallest first, so the pattern is established on cheap material before it meets `task-linker`.

**T3. `cache-coordinator.test.ts` solitary.** Four collaborators, two methods each, 8 mutants. The pilot.

**T4. `metadata-inheritor.test.ts` solitary.** Fake accessor array per 3.2, stubbed `MetadataSyncCache`. 21 mutants.

**T5. `task-linker.test.ts` solitary.** Stub `TaskParser` (4 methods), `RelationshipAnalyzer` (1), `IdGenerator` (1), `MetadataInheritor` (2). 20 mutants. This suite currently exercises `TaskParser`'s marker regexes through 51 assertions, which is the leakage the policy targets.

**T6. Split `marker-invariants.test.ts`.**

The property suite covers two subjects at once. Split it by subject:

- `tests/unit/marker-accessor.invariants.test.ts`: laws that hold within `MarkerAccessorRegistry` itself, such as `remove` being idempotent, `read(remove(x))` returning null, and `hasFragment(x)` implying `read(x) === null`. The registry is the subject, so using it directly is correct.
- `tests/unit/line-snapshot-store.invariants.test.ts`: laws about the store, with a stubbed registry.

Keep the 8 deterministic seeds. Randomised seeds would make a mutation gate flap.

### Phase 4: the uncovered files

**T7. `tests/unit/link-pass.test.ts`.** 17 mutants. Four collaborators, one to two methods each. Cover the id-blocked skip rule, the pass-local `existingIds` growth after a mint, and the returned snapshot.

**T8. `tests/unit/cleanup-pass.test.ts`.** 50 mutants, the largest single piece of work. Cover each of the three sub-passes in isolation, `collectKnownIds`, `collectIdsInRange`, and the block-relative index convention: `cleanStaleDeps` passes a block-relative `bi` while `cleanDanglingDeps` and `cleanOrphanedIds` pass `i - start`, and `applyCleanedLine` adds `currentBlock.start` back. Mutating that arithmetic must fail a test.

**T9. `tests/unit/editor-processor.test.ts`, `component-graph.test.ts`, `indent-config-reader.test.ts`.** One mutant each. `EditorProcessor` needs a module mock for `CursorGuard`; assert the call order `beginPass`, `linkPass.run`, `cleanupPass.run`, `endPass`, `restore`. `ComponentGraph` gets the sociable test from 3.1. `IndentConfigReader` gets both defaults and both overrides.

**T10. `tests/unit/main.test.ts`.** 17 mutants. Module-mock the five constructed collaborators per 3.3. Cover the Tasks plugin gate, `onunload` before `onload`, the `view.file?.path ?? ''` fallback, and that `refreshLiveCache` runs after `processAllLines` rather than before.

Eleven of the 25 tests in `tests/integration/main.test.ts` are lifecycle and wiring behaviour of `main.ts` alone and translate directly. The other fourteen need the real object graph and stay.

### Phase 5: prune

**T11. Shrink the two remaining integration suites.**

`tests/integration/editor-processor.test.ts` holds 53 tests. The classification:

| Bucket | Count | Disposition |
|---|---|---|
| behaviour owned by `CleanupPass` | 24 | delete, replaced by T8 |
| behaviour owned by `LinkPass` | 5 | delete, replaced by T7 |
| genuine multi-class interaction | 24 | keep |

The 24 kept cases are the ones where the assertion only holds because `LineWriteArbiter` suppression, the caches, `CursorGuard` and the two passes interact, plus the multi-pass regression cases and the deletion fuzz suite.

`tests/integration/main.test.ts` drops the 11 solitary cases and keeps the 14 that need the real graph.

Delete only after the unit gate is green at the ratchet reached in Phase 4. If deleting a test drops the score, the replacement unit test was weaker than the test it replaced, and the fix is a better unit test, not a restored integration test.

**T12. Close the gate.**

Set `thresholds.break` to 100 in `stryker.unit.mjs`, repoint `npm test` at the unit gate per 4.3, and re-run the 4.4 proof against the final configuration.

## 6. Gate per commit

Each commit passes `npm run check` end to end, plus the new gate:

1. `npm run lint`
2. `tsc -noEmit -skipLibCheck`
3. `npm run typecheck:tests`
4. `npm run fta`, no file at or above 60
5. `npm test`
6. `npm run test:mutation:unit`, at or above the current ratchet
7. `npm run build`

From T12 onward step 6 folds into step 5.

## 7. Risks and constraints

**Stub drift is the real cost.** A stubbed `TaskParser` encodes an assumption about what `addIdToLine` returns. If the real method changes, the unit test keeps passing against a stale assumption. The integration suite is what catches that, which is the reason Phase 5 keeps 24 cases in `editor-processor.test.ts` rather than emptying the file. Solitary tests pin behaviour; the interaction tests pin the contracts between them. Neither replaces the other.

**Assertion-free stubs produce tautologies.** The failure mode of solitary testing is a test that mocks the answer and then asserts the answer. Section 3.4 exists to prevent it, and the leakage probe in 4.5 cannot detect it. Reviewing the assertions is the only defence.

**T8 is where the schedule slips.** Fifty mutants across three sub-passes with shared per-call state, and the index convention is easy to get subtly wrong. Budget it as several sessions, not one.

**The 306 compile errors are normal.** Stryker's TypeScript checker rejects mutants that do not type-check, and those are excluded from the score rather than counted as survivors. The number will move as tests change. It is not a defect.

**`disableBail` changes the report, not the score.** Turn it on only when hunting for every test that kills a given mutant.

**Mutation ranges beat file-level runs during development.** `-m 'src/processing/cleanup-pass.ts:40-58'` turns a two-minute cycle into seconds while writing tests for one method.

## 8. Settled decisions

| Question | Answer |
|---|---|
| Metric for statement 1 | Mutation score, not line coverage. |
| Mocking default | Solitary. Every collaborator gets a double. |
| Escape clause | A real collaborator only where the double would cost more than the class. The audit found one case, `ComponentGraph`. |
| Dependency injection container | Rejected. Constructor injection already makes every collaborator replaceable, the wiring is 25 lines at complexity 1, and a container would erase the static import edges that enforce the layer order. |
| Classes constructed internally | Vitest module mocking. No production change to make them injectable. |
| Test folder layout | `tests/unit` and `tests/integration` stay. Files move between them, the split does not change. |
| Order of work | Unit tests first, prune integration tests last. |
| Enforcement | A committed unit-only Stryker config with a ratcheting break threshold, wired into `npm run check`. |

