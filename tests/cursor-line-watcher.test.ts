import { describe, it, expect, vi } from 'vitest';
import { CursorLineWatcher } from '../src/cursor-line-watcher';
import type { CapturedUpdateListener } from './__mocks__/codemirror-view';
import type { ViewUpdate } from '@codemirror/view';

/**
 * Builds a structural fake `ViewUpdate`. Only the fields `CursorLineWatcher`
 * actually reads are populated: `selectionSet`, `docChanged`, the cursor
 * head position, and a `lineAt` stub that maps a position to a 1-based
 * line number.
 */
function fakeUpdate(options: {
	selectionSet: boolean;
	head: number;
	lineForHead: number;
	docChanged?: boolean;
}): ViewUpdate {
	const lineAt = vi.fn((_pos: number) => ({ number: options.lineForHead }));
	return {
		selectionSet: options.selectionSet,
		docChanged: options.docChanged ?? false,
		state: {
			selection: { main: { head: options.head } },
			doc: { lineAt },
		},
	} as unknown as ViewUpdate;
}

describe('CursorLineWatcher', () => {
	it('does not call the callback when selectionSet is false', () => {
		const onLineChange = vi.fn();
		const watcher = new CursorLineWatcher(onLineChange);

		watcher.handle(fakeUpdate({ selectionSet: false, head: 10, lineForHead: 5 }));

		expect(onLineChange).not.toHaveBeenCalled();
	});

	it('does not call the callback when selectionSet is false even if the head is on a different line', () => {
		const onLineChange = vi.fn();
		const watcher = new CursorLineWatcher(onLineChange);

		watcher.handle(fakeUpdate({ selectionSet: true, head: 0, lineForHead: 1 }));
		onLineChange.mockClear();
		watcher.handle(fakeUpdate({ selectionSet: false, head: 99, lineForHead: 9 }));

		expect(onLineChange).not.toHaveBeenCalled();
	});

	it('records the line on the first observation without calling the callback', () => {
		const onLineChange = vi.fn();
		const watcher = new CursorLineWatcher(onLineChange);

		watcher.handle(fakeUpdate({ selectionSet: true, head: 12, lineForHead: 3 }));

		expect(onLineChange).not.toHaveBeenCalled();
	});

	it('calls the callback exactly once when the cursor moves to a different line', () => {
		const onLineChange = vi.fn();
		const watcher = new CursorLineWatcher(onLineChange);

		watcher.handle(fakeUpdate({ selectionSet: true, head: 0, lineForHead: 1 }));
		watcher.handle(fakeUpdate({ selectionSet: true, head: 20, lineForHead: 2 }));

		expect(onLineChange).toHaveBeenCalledTimes(1);
	});

	it('does not call the callback again while the cursor stays on the same line', () => {
		const onLineChange = vi.fn();
		const watcher = new CursorLineWatcher(onLineChange);

		watcher.handle(fakeUpdate({ selectionSet: true, head: 0, lineForHead: 1 }));
		watcher.handle(fakeUpdate({ selectionSet: true, head: 20, lineForHead: 2 }));
		onLineChange.mockClear();

		watcher.handle(fakeUpdate({ selectionSet: true, head: 21, lineForHead: 2 }));
		watcher.handle(fakeUpdate({ selectionSet: true, head: 25, lineForHead: 2 }));

		expect(onLineChange).not.toHaveBeenCalled();
	});

	it('calls the callback each time the line number actually changes, including moving back', () => {
		const onLineChange = vi.fn();
		const watcher = new CursorLineWatcher(onLineChange);

		watcher.handle(fakeUpdate({ selectionSet: true, head: 0, lineForHead: 1 }));
		watcher.handle(fakeUpdate({ selectionSet: true, head: 20, lineForHead: 2 }));
		watcher.handle(fakeUpdate({ selectionSet: true, head: 0, lineForHead: 1 }));

		expect(onLineChange).toHaveBeenCalledTimes(2);
	});

	it('treats the next update after reset() as a first observation again', () => {
		const onLineChange = vi.fn();
		const watcher = new CursorLineWatcher(onLineChange);

		watcher.handle(fakeUpdate({ selectionSet: true, head: 0, lineForHead: 1 }));
		watcher.handle(fakeUpdate({ selectionSet: true, head: 20, lineForHead: 2 }));
		onLineChange.mockClear();

		// The line after reset() differs from the last remembered line (2), so a
		// no-op reset() would still see it as "different" and incorrectly fire.
		// Only a real reset() (clearing to null) makes this a first observation.
		watcher.reset();
		watcher.handle(fakeUpdate({ selectionSet: true, head: 50, lineForHead: 5 }));

		expect(onLineChange).not.toHaveBeenCalled();
	});

	it('fires again after reset() once the cursor moves away from the re-recorded line', () => {
		const onLineChange = vi.fn();
		const watcher = new CursorLineWatcher(onLineChange);

		watcher.handle(fakeUpdate({ selectionSet: true, head: 0, lineForHead: 1 }));
		watcher.reset();
		watcher.handle(fakeUpdate({ selectionSet: true, head: 0, lineForHead: 1 }));
		onLineChange.mockClear();

		watcher.handle(fakeUpdate({ selectionSet: true, head: 5, lineForHead: 7 }));

		expect(onLineChange).toHaveBeenCalledTimes(1);
	});

	it('extension() returns the value produced by EditorView.updateListener.of, wired to handle', () => {
		const onLineChange = vi.fn();
		const watcher = new CursorLineWatcher(onLineChange);

		const ext = watcher.extension() as unknown as CapturedUpdateListener;
		expect(typeof ext.fn).toBe('function');

		ext.fn(fakeUpdate({ selectionSet: true, head: 0, lineForHead: 1 }));
		ext.fn(fakeUpdate({ selectionSet: true, head: 10, lineForHead: 4 }));

		expect(onLineChange).toHaveBeenCalledTimes(1);
	});

	it('calls lineAt with the selection head position exactly', () => {
		const onLineChange = vi.fn();
		const watcher = new CursorLineWatcher(onLineChange);
		const lineAt = vi.fn((_pos: number) => ({ number: 3 }));
		const update = {
			selectionSet: true,
			docChanged: false,
			state: {
				selection: { main: { head: 42, anchor: 0 } },
				doc: { lineAt },
			},
		} as unknown as ViewUpdate;

		watcher.handle(update);

		expect(lineAt).toHaveBeenCalledWith(42);
	});
});
