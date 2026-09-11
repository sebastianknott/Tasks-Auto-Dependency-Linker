import { describe, it, expect, vi, type Mock } from 'vitest';
import { LinkPass } from '../../src/processing/link-pass';
import type { TaskLinker } from '../../src/linking/task-linker';
import type { TaskParser } from '../../src/parsing/task-parser';
import type { LineWriteArbiter } from '../../src/editing/line-write-arbiter';
import type { LineEditor } from '../../src/types';
import { createLineEditor } from '../fixtures/editor';

/**
 * Solitary unit test for LinkPass.
 *
 * LinkPass calls exactly these collaborator methods: TaskLinker.prepareForLinkPass
 * and processLine, TaskParser.getTaskId, MarkerCacheLike.getAll, and
 * LineWriteArbiter.blocksIdMinting. Every one of them is replaced below by a
 * hand rolled vi.fn() double, driven by explicit per test data. No real
 * TaskLinker, TaskParser, MarkerCacheLike implementation or LineWriteArbiter
 * is ever constructed, so nothing else in the codebase can be pinned by this
 * file. The LineEditor double comes from the shared fixtures, which hold no
 * production dependencies of their own.
 */

interface FakeLinker {
	prepareForLinkPass: Mock<(editor: LineEditor) => void>;
	processLine: Mock<
		(editor: LineEditor, lineIndex: number, existingIds: ReadonlySet<string>) => string | null
	>;
}

function createFakeLinker(overrides: Partial<FakeLinker> = {}): FakeLinker {
	return {
		prepareForLinkPass: vi.fn(),
		processLine: vi.fn(() => null),
		...overrides,
	};
}

interface FakeParser {
	getTaskId: Mock<(line: string) => string | null>;
}

function createFakeParser(overrides: Partial<FakeParser> = {}): FakeParser {
	return {
		getTaskId: vi.fn(() => null),
		...overrides,
	};
}

interface FakeIdCache {
	getAll: Mock<() => Set<string>>;
	getAllExcluding: Mock<(filePath: string) => Set<string>>;
}

function createFakeIdCache(overrides: Partial<FakeIdCache> = {}): FakeIdCache {
	return {
		getAll: vi.fn(() => new Set<string>()),
		getAllExcluding: vi.fn(() => new Set<string>()),
		...overrides,
	};
}

interface FakeArbiter {
	blocksIdMinting: Mock<(lineIndex: number) => boolean>;
}

function createFakeArbiter(overrides: Partial<FakeArbiter> = {}): FakeArbiter {
	return {
		blocksIdMinting: vi.fn(() => false),
		...overrides,
	};
}

interface Fakes {
	linker?: FakeLinker;
	parser?: FakeParser;
	idCache?: FakeIdCache;
	arbiter?: FakeArbiter;
}

interface Built {
	pass: LinkPass;
	linker: FakeLinker;
	parser: FakeParser;
	idCache: FakeIdCache;
	arbiter: FakeArbiter;
}

/**
 * Wires a LinkPass from the given fakes, filling in a harmless default for
 * any collaborator the test does not care about. The default TaskLinker
 * does nothing and mints no id, the default TaskParser reports every line
 * as missing an id, the default MarkerCacheLike starts with an empty id
 * set, and the default LineWriteArbiter never blocks minting.
 */
function buildPass(fakes: Fakes = {}): Built {
	const linker = fakes.linker ?? createFakeLinker();
	const parser = fakes.parser ?? createFakeParser();
	const idCache = fakes.idCache ?? createFakeIdCache();
	const arbiter = fakes.arbiter ?? createFakeArbiter();
	const pass = new LinkPass(
		linker as unknown as TaskLinker,
		parser as unknown as TaskParser,
		idCache,
		arbiter as unknown as LineWriteArbiter,
	);
	return { pass, linker, parser, idCache, arbiter };
}

describe('LinkPass', () => {
	describe('run', () => {
		it('prepares the pass, then for each line checks the id, consults the arbiter only when the id is missing, and processes the line', () => {
			const order: string[] = [];
			const linker = createFakeLinker({
				prepareForLinkPass: vi.fn(() => {
					order.push('prepare');
				}),
				processLine: vi.fn(() => {
					order.push('processLine');
					return null;
				}),
			});
			const parser = createFakeParser({
				getTaskId: vi.fn(() => {
					order.push('getTaskId');
					return null;
				}),
			});
			const arbiter = createFakeArbiter({
				blocksIdMinting: vi.fn(() => {
					order.push('blocksIdMinting');
					return false;
				}),
			});
			const idCache = createFakeIdCache();
			const { pass } = buildPass({ linker, parser, idCache, arbiter });
			const editor = createLineEditor(['- [ ] Only line']);

			pass.run(editor);

			expect(order).toEqual(['prepare', 'getTaskId', 'blocksIdMinting', 'processLine']);
		});

		it('does not consult the arbiter when the id is already present, and still processes the line', () => {
			const parser = createFakeParser({ getTaskId: vi.fn(() => 'abc123') });
			const arbiter = createFakeArbiter({ blocksIdMinting: vi.fn(() => true) });
			const linker = createFakeLinker();
			const idCache = createFakeIdCache();
			const { pass } = buildPass({ linker, parser, idCache, arbiter });
			const editor = createLineEditor(['- [ ] Task 🆔 abc123']);

			pass.run(editor);

			expect(arbiter.blocksIdMinting).not.toHaveBeenCalled();
			expect(linker.processLine).toHaveBeenCalledTimes(1);
		});

		it('skips a line whose id is missing when the arbiter blocks minting, but still processes a later line', () => {
			const parser = createFakeParser({ getTaskId: vi.fn(() => null) });
			const arbiter = createFakeArbiter({ blocksIdMinting: vi.fn((i: number) => i === 0) });
			const linker = createFakeLinker();
			const idCache = createFakeIdCache();
			const { pass } = buildPass({ linker, parser, idCache, arbiter });
			const editor = createLineEditor(['- [ ] Blocked', '- [ ] Allowed']);

			pass.run(editor);

			expect(linker.processLine).toHaveBeenCalledTimes(1);
			expect(linker.processLine).toHaveBeenCalledWith(editor, 1, expect.any(Set));
		});

		it('passes each line text to the parser and the matching index to the arbiter', () => {
			const parser = createFakeParser({ getTaskId: vi.fn(() => null) });
			const arbiter = createFakeArbiter({ blocksIdMinting: vi.fn(() => false) });
			const linker = createFakeLinker();
			const idCache = createFakeIdCache();
			const { pass } = buildPass({ linker, parser, idCache, arbiter });
			const editor = createLineEditor(['- [ ] First', '- [ ] Second']);

			pass.run(editor);

			expect(parser.getTaskId).toHaveBeenNthCalledWith(1, '- [ ] First');
			expect(parser.getTaskId).toHaveBeenNthCalledWith(2, '- [ ] Second');
			expect(arbiter.blocksIdMinting).toHaveBeenNthCalledWith(1, 0);
			expect(arbiter.blocksIdMinting).toHaveBeenNthCalledWith(2, 1);
		});

		it('starts the pass local existingIds set from what the id cache reports', () => {
			const seen: string[][] = [];
			const linker = createFakeLinker({
				processLine: vi.fn((_editor: LineEditor, _lineIndex: number, existingIds: ReadonlySet<string>) => {
					seen.push([...existingIds]);
					return null;
				}),
			});
			const parser = createFakeParser({ getTaskId: vi.fn(() => null) });
			const idCache = createFakeIdCache({ getAll: vi.fn(() => new Set(['fromCache'])) });
			const arbiter = createFakeArbiter();
			const { pass } = buildPass({ linker, parser, idCache, arbiter });
			const editor = createLineEditor(['- [ ] Only line']);

			pass.run(editor);

			expect(seen).toEqual([['fromCache']]);
		});

		it('adds a freshly minted id to the pass local existingIds set so a later line sees it', () => {
			const snapshots: string[][] = [];
			const linker = createFakeLinker({
				processLine: vi.fn((_editor: LineEditor, lineIndex: number, existingIds: ReadonlySet<string>) => {
					snapshots.push([...existingIds]);
					return lineIndex === 0 ? 'freshId' : null;
				}),
			});
			const parser = createFakeParser({ getTaskId: vi.fn(() => null) });
			const idCache = createFakeIdCache({ getAll: vi.fn(() => new Set(['preexisting'])) });
			const arbiter = createFakeArbiter();
			const { pass } = buildPass({ linker, parser, idCache, arbiter });
			const editor = createLineEditor(['- [ ] First', '- [ ] Second']);

			pass.run(editor);

			expect(snapshots[0]).toEqual(['preexisting']);
			expect(snapshots[1]).toEqual(['preexisting', 'freshId']);
		});

		it('leaves the pass local existingIds set unchanged across lines when processLine mints nothing', () => {
			const snapshots: string[][] = [];
			const linker = createFakeLinker({
				processLine: vi.fn((_editor: LineEditor, _lineIndex: number, existingIds: ReadonlySet<string>) => {
					snapshots.push([...existingIds]);
					return null;
				}),
			});
			const parser = createFakeParser({ getTaskId: vi.fn(() => null) });
			const idCache = createFakeIdCache({ getAll: vi.fn(() => new Set(['pre'])) });
			const arbiter = createFakeArbiter();
			const { pass } = buildPass({ linker, parser, idCache, arbiter });
			const editor = createLineEditor(['- [ ] A', '- [ ] B']);

			pass.run(editor);

			expect(snapshots).toEqual([['pre'], ['pre']]);
		});

		it('processes exactly as many lines as the editor reports', () => {
			const linker = createFakeLinker();
			const parser = createFakeParser({ getTaskId: vi.fn(() => null) });
			const idCache = createFakeIdCache();
			const arbiter = createFakeArbiter();
			const { pass } = buildPass({ linker, parser, idCache, arbiter });
			const editor = createLineEditor(['- [ ] A', '- [ ] B', '- [ ] C']);

			pass.run(editor);

			expect(linker.processLine).toHaveBeenCalledTimes(3);
			expect(linker.processLine).toHaveBeenNthCalledWith(1, editor, 0, expect.any(Set));
			expect(linker.processLine).toHaveBeenNthCalledWith(2, editor, 1, expect.any(Set));
			expect(linker.processLine).toHaveBeenNthCalledWith(3, editor, 2, expect.any(Set));
		});

		it('returns every line as it stands after linking, reflecting any write processLine made', () => {
			const editor = createLineEditor(['- [ ] Parent', '- [ ] Child']);
			const linker = createFakeLinker({
				processLine: vi.fn((e: LineEditor, lineIndex: number) => {
					if (lineIndex === 1) {
						e.setLine(0, '- [ ] Parent ⛔ abc123');
						e.setLine(1, '- [ ] Child 🆔 abc123');
						return 'abc123';
					}
					return null;
				}),
			});
			const parser = createFakeParser({ getTaskId: vi.fn(() => null) });
			const idCache = createFakeIdCache();
			const arbiter = createFakeArbiter();
			const { pass } = buildPass({ linker, parser, idCache, arbiter });

			const result = pass.run(editor);

			expect(result).toEqual(['- [ ] Parent ⛔ abc123', '- [ ] Child 🆔 abc123']);
		});

		it('returns an empty array and calls nothing else when the editor has no lines', () => {
			const linker = createFakeLinker();
			const parser = createFakeParser();
			const idCache = createFakeIdCache();
			const arbiter = createFakeArbiter();
			const { pass } = buildPass({ linker, parser, idCache, arbiter });
			const editor = createLineEditor([]);

			const result = pass.run(editor);

			expect(result).toEqual([]);
			expect(linker.prepareForLinkPass).toHaveBeenCalledTimes(1);
			expect(linker.processLine).not.toHaveBeenCalled();
			expect(parser.getTaskId).not.toHaveBeenCalled();
			expect(arbiter.blocksIdMinting).not.toHaveBeenCalled();
		});
	});
});
