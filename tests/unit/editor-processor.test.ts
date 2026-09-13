import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EditorLike } from '../../src/types';
import type { LinkPass } from '../../src/processing/link-pass';
import type { CleanupPass } from '../../src/processing/cleanup-pass';
import type { LineWriteArbiter } from '../../src/editing/line-write-arbiter';
import { CursorGuard } from '../../src/editing/cursor-guard';
import { EditorProcessor } from '../../src/processing/editor-processor';

/**
 * EditorProcessor does `new CursorGuard(editor)` inside processAllLines, so
 * the guard cannot be reached through the constructor the way the other
 * three collaborators are. This suite replaces the cursor-guard module with
 * a vitest module mock rather than changing production code to make the
 * guard injectable.
 *
 * Every stub that participates in the ordering assertion pushes its own name
 * onto a shared `order` array, so the test pins the exact sequence
 * EditorProcessor drives its collaborators in: beginPass, then LinkPass.run,
 * then CleanupPass.run, then endPass, then the guard's restore.
 */

const { guardState } = vi.hoisted((): { guardState: { current: unknown } } => ({
	guardState: { current: undefined },
}));

vi.mock('../../src/editing/cursor-guard', () => ({
	CursorGuard: vi.fn(() => guardState.current),
}));

interface FakeGuard {
	cursorLine: number;
	restore: ReturnType<typeof vi.fn>;
}

function createFakeGuard(cursorLine: number, order: string[]): FakeGuard {
	return {
		cursorLine,
		restore: vi.fn(() => {
			order.push('restore');
		}),
	};
}

interface FakeLinkPass {
	run: ReturnType<typeof vi.fn>;
}

function createFakeLinkPass(order: string[], lines: string[] = []): FakeLinkPass {
	return {
		run: vi.fn(() => {
			order.push('linkPass.run');
			return lines;
		}),
	};
}

interface FakeCleanupPass {
	run: ReturnType<typeof vi.fn>;
}

function createFakeCleanupPass(order: string[]): FakeCleanupPass {
	return {
		run: vi.fn(() => {
			order.push('cleanupPass.run');
		}),
	};
}

interface FakeArbiter {
	beginPass: ReturnType<typeof vi.fn>;
	endPass: ReturnType<typeof vi.fn>;
}

function createFakeArbiter(order: string[]): FakeArbiter {
	return {
		beginPass: vi.fn(() => {
			order.push('beginPass');
		}),
		endPass: vi.fn(() => {
			order.push('endPass');
		}),
	};
}

describe('EditorProcessor', () => {
	let order: string[];
	let editor: EditorLike;
	let linkPass: FakeLinkPass;
	let cleanupPass: FakeCleanupPass;
	let arbiter: FakeArbiter;
	let processor: InstanceType<typeof EditorProcessor>;

	beforeEach(() => {
		order = [];
		// Never touched by the production code under test: CursorGuard is
		// module-mocked, so the real constructor that would call getCursor
		// on this object never runs.
		editor = {} as EditorLike;
		guardState.current = createFakeGuard(3, order);
		linkPass = createFakeLinkPass(order);
		cleanupPass = createFakeCleanupPass(order);
		arbiter = createFakeArbiter(order);
		processor = new EditorProcessor(
			linkPass as unknown as LinkPass,
			cleanupPass as unknown as CleanupPass,
			arbiter as unknown as LineWriteArbiter,
		);
	});

	it('drives its collaborators in the order beginPass, linkPass.run, cleanupPass.run, endPass, restore', () => {
		processor.processAllLines(editor, 'notes/a.md');

		expect(order).toEqual([
			'beginPass',
			'linkPass.run',
			'cleanupPass.run',
			'endPass',
			'restore',
		]);
	});

	it('builds the cursor guard from the editor it was given', () => {
		processor.processAllLines(editor, 'notes/a.md');

		expect(CursorGuard).toHaveBeenCalledWith(editor);
	});

	it('passes the guard, the guard\'s cursor line, and the file path to beginPass', () => {
		processor.processAllLines(editor, 'notes/a.md');

		expect(arbiter.beginPass).toHaveBeenCalledWith(guardState.current, 3, 'notes/a.md');
	});

	it('passes the arbiter to linkPass.run', () => {
		processor.processAllLines(editor, 'notes/a.md');

		expect(linkPass.run).toHaveBeenCalledWith(arbiter);
	});

	it('passes the arbiter, the lines linkPass returned, and the file path to cleanupPass.run', () => {
		const lines = ['line a', 'line b'];
		linkPass = createFakeLinkPass(order, lines);
		processor = new EditorProcessor(
			linkPass as unknown as LinkPass,
			cleanupPass as unknown as CleanupPass,
			arbiter as unknown as LineWriteArbiter,
		);

		processor.processAllLines(editor, 'notes/a.md');

		expect(cleanupPass.run).toHaveBeenCalledWith(arbiter, lines, 'notes/a.md');
	});

	it('restores the guard even though the guard is never asked to read or write a line', () => {
		processor.processAllLines(editor, 'notes/a.md');

		const guard = guardState.current as FakeGuard;
		expect(guard.restore).toHaveBeenCalledTimes(1);
	});
});
