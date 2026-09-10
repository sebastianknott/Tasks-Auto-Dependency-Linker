/**
 * Shared editor fixtures for the test suite.
 *
 * Six test files used to carry their own near-identical editor mock. These
 * builders replace them. They deliberately expose two separate shapes,
 * {@link LineEditorFixture} and {@link EditorFixture}, mirroring the
 * {@link LineEditor} and `EditorLike` ports in `src/types.ts`. A test
 * that only needs line access gets an object without `getCursor`, so a
 * production class that starts reaching for the caret cannot silently pick
 * it up from an over-provisioned fixture.
 *
 * `obsidian-editor-adapter.test.ts` keeps its own mock. It stands in for
 * Obsidian's real `Editor`, whose `setLine` returns `void`, so it does not
 * fit either port here.
 */
import { vi, type Mock } from 'vitest';
import type { EditorPositionLike, LineEditor } from '../../src/types';

/** {@link LineEditor} with every member replaced by a spy. */
export interface LineEditorFixture extends LineEditor {
	lineCount: Mock<() => number>;
	getLine: Mock<(n: number) => string>;
	setLine: Mock<(n: number, text: string) => string>;
}

/**
 * `EditorLike` with every member replaced by a spy.
 *
 * Extends {@link LineEditorFixture} rather than `EditorLike` directly,
 * because the two declare `getLine` with different types: a plain method
 * versus a `Mock`. Structurally this is still an `EditorLike`.
 */
export interface EditorFixture extends LineEditorFixture {
	getCursor: Mock<(which?: 'anchor' | 'head') => EditorPositionLike>;
	setSelection: Mock<
		(anchor: EditorPositionLike, head: EditorPositionLike) => void
	>;
}

/**
 * Cursor position used when a test does not care where the caret sits.
 *
 * Line -1 is out of range on purpose. Tests that predate
 * `LineWriteArbiter`, and never meant to place the caret anywhere,
 * must not be accidentally protected by cursor-line suppression.
 */
export const OFF_SCREEN_CURSOR: EditorPositionLike = { line: -1, ch: 0 };

/**
 * Reads a line, refusing an out-of-range index.
 *
 * Returning `undefined` for a bad index would let a production bug travel
 * silently into an assertion about the wrong thing. Throwing names the
 * offending index at the point it is asked for.
 */
function readLine(lines: string[], n: number): string {
	if (n < 0 || n >= lines.length) {
		throw new RangeError(`getLine(${n}) out of bounds (0..${lines.length - 1})`);
	}
	return lines[n]!;
}

/**
 * Builds the three {@link LineEditor} members over a backing array, leaving
 * the caller to decide what a write does.
 */
function createLineMembers(
	lines: string[],
	write: (n: number, text: string) => string,
): LineEditorFixture {
	return {
		lineCount: vi.fn(() => lines.length),
		getLine: vi.fn((n: number) => readLine(lines, n)),
		setLine: vi.fn(write),
	};
}

/** Stores a proposed write verbatim and reports it back. */
function storeWrite(lines: string[]): (n: number, text: string) => string {
	return (n: number, text: string) => {
		lines[n] = text;
		return text;
	};
}

/**
 * Editor that accepts every write, backed by `lines`.
 *
 * Writes mutate `lines` in place, so a test can assert on the array it
 * passed in rather than reading back through the fixture.
 */
export function createLineEditor(lines: string[]): LineEditorFixture {
	return createLineMembers(lines, storeWrite(lines));
}

/**
 * Editor whose `setLine` never mutates its backing lines.
 *
 * Mimics `LineWriteArbiter`'s indeterminate-cursor-line branch, where
 * a write is proposed but the arbiter refuses it outright.
 */
export function createRefusingEditor(lines: string[]): LineEditorFixture {
	return createLineMembers(lines, (n: number) => readLine(lines, n));
}

/**
 * Editor that accepts a proposed write but applies `correct` to it first.
 *
 * Mimics `LineWriteArbiter` freezing an unrelated suppressed marker on
 * the same line while still accepting the rest of the proposal, for example
 * the new dependency.
 */
export function createCorrectingEditor(
	lines: string[],
	correct: (n: number, text: string) => string,
): LineEditorFixture {
	return createLineMembers(lines, (n: number, text: string) => {
		const corrected = correct(n, text);
		lines[n] = corrected;
		return corrected;
	});
}

/**
 * Editor that accepts every write and reports a fixed selection.
 *
 * `head` defaults to `anchor`, which covers the common case of a collapsed
 * caret. Pass both to exercise a range selection.
 */
export function createEditor(
	lines: string[],
	anchor: EditorPositionLike = OFF_SCREEN_CURSOR,
	head: EditorPositionLike = anchor,
): EditorFixture {
	return {
		...createLineMembers(lines, storeWrite(lines)),
		getCursor: vi.fn((which?: 'anchor' | 'head') =>
			which === 'head' ? head : anchor,
		),
		setSelection: vi.fn(),
	};
}
