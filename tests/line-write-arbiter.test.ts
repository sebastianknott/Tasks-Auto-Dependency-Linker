import { describe, it, expect } from 'vitest';
import { LineWriteArbiter } from '../src/line-write-arbiter';
import { MarkerAccessorRegistry, MarkerType } from '../src/marker-accessor';
import { TaskParser } from '../src/task-parser';
import { TaskMetadataParser } from '../src/task-metadata-parser';
import { createLineEditor } from './fixtures/editor';

function createArbiter(): LineWriteArbiter {
	const registry = new MarkerAccessorRegistry(new TaskParser(), new TaskMetadataParser());
	return new LineWriteArbiter(registry);
}

describe('LineWriteArbiter: cold arrival (the actual bug fix)', () => {
	it('rejects re-adding an id deleted with no editor event between passes', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] Task \u{1F194} abc'];
		let target = createLineEditor(lines);

		// A real pass runs once, capturing a snapshot of the tagged line.
		arbiter.beginPass(target, 0, 'file.md');
		arbiter.endPass();

		// The caret moves to this line with arrow keys (no event fires),
		// then the user deletes the marker by hand. That deletion is the
		// keystroke that finally triggers the debounced pass.
		lines[0] = '- [ ] Task';
		target = createLineEditor(lines);
		arbiter.beginPass(target, 0, 'file.md');

		expect(arbiter.isSuppressed(0, MarkerType.Id)).toBe(true);

		// The plugin's own logic tries to regenerate the id; the arbiter
		// must block it.
		const result = arbiter.setLine(0, '- [ ] Task \u{1F194} abc');
		expect(result).toBe('- [ ] Task');
		expect(target.setLine).not.toHaveBeenCalled();
	});

	it('does not restore a dependency backspaced down to a bare \u26D4 marker with no id text left', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] Parent \u26D4 abc123', '\t- [ ] Child \u{1F194} abc123'];
		let target = createLineEditor(lines);

		// A real pass runs once, capturing the dependency in the snapshot.
		arbiter.beginPass(target, 0, 'file.md');
		arbiter.endPass();

		// Backspacing through the id one character at a time passes through
		// this intermediate state: the \u26D4 marker itself is still there,
		// but every id character has been deleted. The regex that parses
		// dependencies requires at least one id character, so this state
		// does not parse as a dependency at all.
		lines[0] = '- [ ] Parent \u26D4 ';
		target = createLineEditor(lines);
		arbiter.beginPass(target, 0, 'file.md');

		expect(arbiter.getSuppressedDepIds().has('abc123')).toBe(true);

		// The link pass still sees the child's id and, finding no parseable
		// dependency on the parent, tries to append a brand new marker.
		const result = arbiter.setLine(0, '- [ ] Parent \u26D4  \u26D4 abc123');
		expect(result).not.toContain('abc123');
		expect(result.split('\u26D4').length - 1).toBeLessThanOrEqual(1);
	});

	it('still recognizes a bare marker with nothing else on the line at all', () => {
		const arbiter = createArbiter();
		const lines = ['\u26D4 abc123'];
		let target = createLineEditor(lines);

		arbiter.beginPass(target, 0, 'file.md');
		arbiter.endPass();

		lines[0] = '\u26D4 ';
		target = createLineEditor(lines);
		arbiter.beginPass(target, 0, 'file.md');

		expect(arbiter.getSuppressedDepIds().has('abc123')).toBe(true);
	});

	it('collapses whitespace left on both sides of a bare marker, not just one side', () => {
		const arbiter = createArbiter();
		const lines = ['Task \u26D4 abc123 more text'];
		let target = createLineEditor(lines);

		arbiter.beginPass(target, 0, 'file.md');
		arbiter.endPass();

		// Deleting just the id characters leaves the space that used to
		// sit before "abc123" adjacent to the space that already followed
		// it, so the marker ends up with whitespace on both sides.
		lines[0] = 'Task \u26D4  more text';
		target = createLineEditor(lines);
		arbiter.beginPass(target, 0, 'file.md');

		expect(arbiter.getSuppressedDepIds().has('abc123')).toBe(true);
	});

	it('collapses whitespace left on both sides of a bare id marker, not just one side', () => {
		const arbiter = createArbiter();
		const lines = ['Task \u{1F194} abc123 more text'];
		let target = createLineEditor(lines);

		arbiter.beginPass(target, 0, 'file.md');
		arbiter.endPass();

		lines[0] = 'Task \u{1F194}  more text';
		target = createLineEditor(lines);
		arbiter.beginPass(target, 0, 'file.md');

		expect(arbiter.isSuppressed(0, MarkerType.Id)).toBe(true);
	});

	it('collapses whitespace left on both sides of a bare due marker, not just one side', () => {
		const arbiter = createArbiter();
		const lines = ['Task \u{1F4C5} 2025-11-15 more text'];
		let target = createLineEditor(lines);

		arbiter.beginPass(target, 0, 'file.md');
		arbiter.endPass();

		lines[0] = 'Task \u{1F4C5}  more text';
		target = createLineEditor(lines);
		arbiter.beginPass(target, 0, 'file.md');

		expect(arbiter.isSuppressed(0, MarkerType.Due)).toBe(true);
	});

	it('collapses whitespace left on both sides of a bare scheduled marker, not just one side', () => {
		const arbiter = createArbiter();
		const lines = ['Task \u23F3 2025-11-15 more text'];
		let target = createLineEditor(lines);

		arbiter.beginPass(target, 0, 'file.md');
		arbiter.endPass();

		lines[0] = 'Task \u23F3  more text';
		target = createLineEditor(lines);
		arbiter.beginPass(target, 0, 'file.md');

		expect(arbiter.isSuppressed(0, MarkerType.Scheduled)).toBe(true);
	});

	it('does not eat a trailing space typed elsewhere on the line while a marker stays suppressed', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] Task \u{1F194} abc'];
		let target = createLineEditor(lines);

		arbiter.beginPass(target, 0, 'file.md');
		arbiter.endPass();

		// The user deletes the id by hand; the id marker type becomes
		// suppressed on this line and stays suppressed while the caret
		// remains here.
		lines[0] = '- [ ] Task';
		target = createLineEditor(lines);
		arbiter.beginPass(target, 0, 'file.md');
		expect(arbiter.isSuppressed(0, MarkerType.Id)).toBe(true);

		// A later keystroke types a trailing space at the end of the same
		// line. Nothing in that proposal touches the id marker, so the
		// arbiter must leave the space alone instead of trimming it away
		// as a side effect of "restoring" a marker that was never there
		// to begin with.
		const result = arbiter.setLine(0, '- [ ] Task ');
		expect(result).toBe('- [ ] Task ');
	});
});

describe('LineWriteArbiter: multi-pass fragment residue (missed suppression across non-cursor passes)', () => {
	// This is the actual bug: a line that is NOT the cursor line at endPass gets a fresh
	// snapshot built from whatever state it is in at that moment, including mid-edit
	// fragments. Prior to the computeBareText fix, a stray due-date fragment ("📅 2026-0")
	// leaked into that snapshot's bareText. When the user later finishes the date and
	// deletes the id on that same line, on the next pass detectSuppression compares the
	// dirty prior bareText against the now-clean current bareText, sees a mismatch, and
	// bails out before ever running detectSuppressedMarkers. The id deletion is never
	// recorded as suppressed, so the plugin's own restoration logic is free to put the id
	// right back, silently clobbering the user's edit.
	it('records a suppressed id deletion made on a line that was dirty at the prior non-cursor snapshot', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] Other', '- [ ] Task \u{1F194} abc \u{1F4C5} 2026-0'];
		let target = createLineEditor(lines);

		// Cursor sits on line 0 for this pass, so line 1 is snapshotted fresh from its
		// current, mid-edit state (an abandoned date fragment plus a well-formed id).
		arbiter.beginPass(target, 0, 'file.md');
		arbiter.endPass();

		// Between passes, with no arbiter pass in between: the date is completed and the
		// id is deleted by hand.
		lines[1] = '- [ ] Task \u{1F4C5} 2026-01-05';
		target = createLineEditor(lines);

		// The caret now moves to line 1, triggering the pass that must recognize the id
		// deletion as deliberate.
		arbiter.beginPass(target, 1, 'file.md');

		expect(arbiter.isSuppressed(1, MarkerType.Id)).toBe(true);

		// The plugin's own restoration logic (mirroring the "cold arrival" tests above)
		// tries to put the same id back; the arbiter must block it.
		const result = arbiter.setLine(1, '- [ ] Task \u{1F194} abc \u{1F4C5} 2026-01-05');
		expect(result).not.toContain('\u{1F194}');
	});

	// The milder side effect of the same root cause: a legitimate cleanup removal of a
	// dangling dependency is blocked for one pass because verifiedDepIds never gets
	// populated when detectSuppression bails on the dirty/clean bareText mismatch.
	it('allows a verified dependency removal made on a line that was dirty at the prior non-cursor snapshot', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] Other', '- [ ] Parent \u26D4 ghost \u{1F4C5} 2026-0'];
		let target = createLineEditor(lines);

		// Cursor sits on line 0, so line 1 (carrying a dangling dep and an abandoned date
		// fragment) is snapshotted fresh from that mid-edit state.
		arbiter.beginPass(target, 0, 'file.md');
		arbiter.endPass();

		// Between passes: the date is completed, the dangling dep is left untouched.
		lines[1] = '- [ ] Parent \u26D4 ghost \u{1F4C5} 2026-01-05';
		target = createLineEditor(lines);

		// The caret moves to line 1 and the user manually deletes the dangling dep.
		arbiter.beginPass(target, 1, 'file.md');
		const result = arbiter.setLine(1, '- [ ] Parent \u{1F4C5} 2026-01-05');

		expect(result).not.toContain('\u26D4');
	});

	// Boundary-pinning test: distinguishes this bug/fix from the separate, accepted
	// "indeterminate cursor line refuses all writes" limitation. A permanently-indeterminate
	// prose line (a due glyph embedded in ordinary text can never parse as a real date, so
	// DueAccessor.hasFragment is always true for it) still refuses all writes while the
	// caret sits on it, fix or no fix; that refusal is unrelated to computeBareText. Moving
	// the caret off the line removes cursor-line protection entirely, since setLine passes
	// non-cursor-line writes straight through with no correction logic at all.
	it('still refuses a cleanup on a permanently-indeterminate prose line while the caret is on it, but allows it once the caret moves away', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] call Bob \u{1F4C5} sometime \u26D4 ghost', '- [ ] Other'];
		let target = createLineEditor(lines);

		arbiter.beginPass(target, 0, 'file.md');
		arbiter.endPass();

		target = createLineEditor(lines);
		arbiter.beginPass(target, 0, 'file.md');
		const blockedResult = arbiter.setLine(0, '- [ ] call Bob \u{1F4C5} sometime');
		expect(blockedResult).toContain('\u26D4');

		target = createLineEditor(lines);
		arbiter.beginPass(target, 1, 'file.md');
		const passthroughResult = arbiter.setLine(0, '- [ ] call Bob \u{1F4C5} sometime');
		expect(passthroughResult).not.toContain('\u26D4');
	});
});

describe('LineWriteArbiter: Enter chain (must not break normal tagging)', () => {
	it('lets a fresh id through on a line whose snapshot entry no longer matches', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] A \u{1F194} aaa', '- [ ] B \u{1F194} bbb'];
		const target1 = createLineEditor(lines);
		arbiter.beginPass(target1, 0, 'file.md');
		arbiter.endPass();

		// Enter is pressed after "A", pushing a new blank subtask into
		// index 1 and shifting "B" down to index 2. The snapshot entry at
		// index 1 still describes "B", not the new blank line.
		lines.splice(1, 0, '- [ ] New subtask');
		const target2 = createLineEditor(lines);
		arbiter.beginPass(target2, 1, 'file.md');

		expect(arbiter.isSuppressed(1, MarkerType.Id)).toBe(false);

		const result = arbiter.setLine(1, '- [ ] New subtask \u{1F194} xyz');
		expect(result).toBe('- [ ] New subtask \u{1F194} xyz');
		expect(target2.setLine).toHaveBeenCalledWith(1, '- [ ] New subtask \u{1F194} xyz');
	});
});

describe('LineWriteArbiter: non-cursor lines', () => {
	it('passes writes on other lines straight through', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] A', '- [ ] B'];
		const target = createLineEditor(lines);
		arbiter.beginPass(target, 0, 'file.md');

		const result = arbiter.setLine(1, '- [ ] B \u{1F194} bbb');

		expect(result).toBe('- [ ] B \u{1F194} bbb');
		expect(target.setLine).toHaveBeenCalledWith(1, '- [ ] B \u{1F194} bbb');
	});

	it('reports isSuppressed as false for any line other than the cursor line', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] A \u{1F4C5} 2025-01-01', '- [ ] B \u{1F4C5} 2025-01-01'];
		const target1 = createLineEditor(lines);
		arbiter.beginPass(target1, 0, 'file.md');
		arbiter.endPass();

		lines[0] = '- [ ] A';
		lines[1] = '- [ ] B';
		const target2 = createLineEditor(lines);
		arbiter.beginPass(target2, 0, 'file.md');

		expect(arbiter.isSuppressed(0, MarkerType.Due)).toBe(true);
		expect(arbiter.isSuppressed(1, MarkerType.Due)).toBe(false);
	});
});

describe('LineWriteArbiter: per-marker granularity', () => {
	it('suppresses one marker type while letting another land in the same setLine call', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] Task \u{1F4C5} 2025-01-01 \u{1F194} abc'];
		const target1 = createLineEditor(lines);
		arbiter.beginPass(target1, 0, 'file.md');
		arbiter.endPass();

		// User deletes the due date only; the id is untouched.
		lines[0] = '- [ ] Task \u{1F194} abc';
		const target2 = createLineEditor(lines);
		arbiter.beginPass(target2, 0, 'file.md');

		expect(arbiter.isSuppressed(0, MarkerType.Due)).toBe(true);
		expect(arbiter.isSuppressed(0, MarkerType.Id)).toBe(false);

		const proposed = '- [ ] Task \u{1F4C5} 2025-01-01 \u{1F194} xyz';
		const result = arbiter.setLine(0, proposed);

		expect(result).toContain('\u{1F194} xyz');
		expect(result).not.toContain('\u{1F4C5}');
	});
});

describe('LineWriteArbiter: dependency granularity', () => {
	it('suppresses one dependency id while letting another through on the same line', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] Task \u26D4 abc123,def456'];
		const target1 = createLineEditor(lines);
		arbiter.beginPass(target1, 0, 'file.md');
		arbiter.endPass();

		// User deletes abc123 only.
		lines[0] = '- [ ] Task \u26D4 def456';
		const target2 = createLineEditor(lines);
		arbiter.beginPass(target2, 0, 'file.md');

		expect(arbiter.getSuppressedDepIds().has('abc123')).toBe(true);
		expect(arbiter.getSuppressedDepIds().has('def456')).toBe(false);

		// The plugin's cleanup pass re-requests both ids, unaware that
		// abc123 was just hand-deleted. abc123 stays blocked because it
		// is suppressed; def456 was never touched, so the proposal
		// keeping it present is honored normally.
		const proposed = '- [ ] Task \u26D4 abc123,def456';
		const result = arbiter.setLine(0, proposed);

		expect(result).toContain('def456');
		expect(result).not.toContain('abc123');
	});

	it('does not re-add a suppressed dependency when the proposal does not request it either', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] Task \u26D4 abc'];
		const target1 = createLineEditor(lines);
		arbiter.beginPass(target1, 0, 'file.md');
		arbiter.endPass();

		lines[0] = '- [ ] Task'; // user deletes the dependency
		const target2 = createLineEditor(lines);
		arbiter.beginPass(target2, 0, 'file.md');
		expect(arbiter.getSuppressedDepIds().has('abc')).toBe(true);

		// An unrelated proposal (adding a due date) never mentions abc.
		const result = arbiter.setLine(0, '- [ ] Task \u{1F4C5} 2025-01-01');

		expect(result).not.toContain('abc');
	});

	it('leaves an already-present, still-desired dependency untouched by the reconciliation loop', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] Task \u26D4 abc'];
		const target = createLineEditor(lines);
		arbiter.beginPass(target, 0, 'file.md');

		const result = arbiter.setLine(0, '- [ ] Task \u26D4 abc \u{1F4C5} 2025-01-01');

		expect(result).toContain('\u26D4 abc');
	});

	it('allows a brand-new dependency to be added when nothing is suppressed', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] Task'];
		const target = createLineEditor(lines);
		arbiter.beginPass(target, 0, 'file.md');

		const result = arbiter.setLine(0, '- [ ] Task \u26D4 newdep');

		expect(result).toContain('\u26D4 newdep');
	});
});

describe('LineWriteArbiter: changed value counts as removed', () => {
	it('suppresses a marker whose value the user changed by hand, not only deleted', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] Task \u{1F53A}'];
		const target1 = createLineEditor(lines);
		arbiter.beginPass(target1, 0, 'file.md');
		arbiter.endPass();

		// User changes priority from highest to low by hand.
		lines[0] = '- [ ] Task \u{1F53D}';
		const target2 = createLineEditor(lines);
		arbiter.beginPass(target2, 0, 'file.md');

		expect(arbiter.isSuppressed(0, MarkerType.Priority)).toBe(true);
	});
});

describe('LineWriteArbiter: additions are never suppressed', () => {
	it('does not suppress a marker that only just appeared, as opposed to one that existed and changed', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] Task'];
		const target1 = createLineEditor(lines);
		arbiter.beginPass(target1, 0, 'file.md');
		arbiter.endPass(); // snapshot: due is absent on line 0

		// Something adds a due date to the line without going through a
		// setLine call the arbiter corrected (e.g. a write from a pass
		// that has not been reconciled with this snapshot yet). The bare
		// text is unaffected, since it strips markers before comparing.
		lines[0] = '- [ ] Task \u{1F4C5} 2025-01-01';
		const target2 = createLineEditor(lines);
		arbiter.beginPass(target2, 0, 'file.md');

		expect(arbiter.isSuppressed(0, MarkerType.Due)).toBe(false);
	});
});

describe('LineWriteArbiter: removal on the cursor line is blocked when the marker\'s state is unverified', () => {
	it('blocks a proposed removal when there is no snapshot to verify against', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] Task \u{1F194} abc'];
		const target = createLineEditor(lines);
		arbiter.beginPass(target, 0, 'file.md');

		expect(arbiter.isSuppressed(0, MarkerType.Id)).toBe(false);

		const result = arbiter.setLine(0, '- [ ] Task');

		expect(result).toBe('- [ ] Task \u{1F194} abc');
	});

	it('blocks a proposed dependency removal and re-adds it when there is no snapshot to verify against', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] Task \u26D4 abc'];
		const target = createLineEditor(lines);
		arbiter.beginPass(target, 0, 'file.md');

		expect(arbiter.getSuppressedDepIds().has('abc')).toBe(false);

		// The proposal drops the dependency outright, so it is missing
		// from the reconciled line before the correction loop runs; the
		// arbiter must add it back rather than merely leave it alone.
		const result = arbiter.setLine(0, '- [ ] Task');

		expect(result).toBe('- [ ] Task \u26D4 abc');
	});
});

describe('LineWriteArbiter: verified untouched removal is allowed (fix for outdent orphan-id bug)', () => {
	it('allows an orphaned id to be removed by a cleanup pass when only indentation changed, not the id', () => {
		const arbiter = createArbiter();
		const lines = ['\t- [ ] Child \u{1F194} abc'];
		const target1 = createLineEditor(lines);
		arbiter.beginPass(target1, 0, 'file.md');
		arbiter.endPass();

		// The user outdents the line (Shift+Tab): only the leading
		// whitespace changes. The id itself is untouched. bareText strips
		// markers and trims, so the leading tab does not affect it.
		lines[0] = '- [ ] Child \u{1F194} abc';
		const target2 = createLineEditor(lines);
		arbiter.beginPass(target2, 0, 'file.md');
		expect(arbiter.isSuppressed(0, MarkerType.Id)).toBe(false);

		// A cleanup pass determines the id is now orphaned and proposes
		// removing it.
		const result = arbiter.setLine(0, '- [ ] Child');

		expect(result).toBe('- [ ] Child');
		expect(target2.setLine).toHaveBeenCalledWith(0, '- [ ] Child');
	});

	it('allows removal of one dependency id while keeping another, when the line itself is untouched', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] Parent \u26D4 child1,child2'];
		const target1 = createLineEditor(lines);
		arbiter.beginPass(target1, 0, 'file.md');
		arbiter.endPass();

		// The caret stays on the parent line; nothing changed this pass.
		const target2 = createLineEditor(lines);
		arbiter.beginPass(target2, 0, 'file.md');

		// A cleanup pass proposes dropping child2 (no longer indented
		// under the parent) while keeping child1.
		const result = arbiter.setLine(0, '- [ ] Parent \u26D4 child1');

		expect(result).toContain('child1');
		expect(result).not.toContain('child2');
	});

	it('does not treat a marker removed via the verification gate as suppressed on the following pass', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] Child \u{1F194} abc'];
		const target1 = createLineEditor(lines);
		arbiter.beginPass(target1, 0, 'file.md');
		arbiter.endPass();

		const target2 = createLineEditor(lines); // unchanged; id untouched
		arbiter.beginPass(target2, 0, 'file.md');
		arbiter.setLine(0, '- [ ] Child'); // cleanup pass removes the orphaned id
		arbiter.endPass();

		// The removal is now what got snapshotted: the prior id is null
		// going forward, so there is nothing left to suppress.
		const target3 = createLineEditor(lines);
		arbiter.beginPass(target3, 0, 'file.md');

		expect(arbiter.isSuppressed(0, MarkerType.Id)).toBe(false);
	});

	it('allows a verified id removal through while a separately suppressed due marker stays frozen, in the same setLine call', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] Task \u{1F4C5} 2025-01-01 \u{1F194} abc'];
		const target1 = createLineEditor(lines);
		arbiter.beginPass(target1, 0, 'file.md');
		arbiter.endPass();

		// The user changes the due date by hand (not deleting it) and
		// leaves the id untouched.
		lines[0] = '- [ ] Task \u{1F4C5} 2025-02-02 \u{1F194} abc';
		const target2 = createLineEditor(lines);
		arbiter.beginPass(target2, 0, 'file.md');
		expect(arbiter.isSuppressed(0, MarkerType.Due)).toBe(true);
		expect(arbiter.isSuppressed(0, MarkerType.Id)).toBe(false);

		// A cleanup pass proposes dropping both the (orphaned) id and the
		// due date, unaware the due date was just hand-edited.
		const result = arbiter.setLine(0, '- [ ] Task');

		expect(result).not.toContain('\u{1F194}');
		expect(result).toContain('\u{1F4C5} 2025-02-02');
	});

	it('preserves trailing whitespace on the proposal when an allowed removal goes through, proving no remove() fires speculatively', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] Child \u{1F194} abc'];
		const target1 = createLineEditor(lines);
		arbiter.beginPass(target1, 0, 'file.md');
		arbiter.endPass();

		const target2 = createLineEditor(lines); // unchanged; id untouched
		arbiter.beginPass(target2, 0, 'file.md');

		// The cleanup pass removes the orphaned id, and the proposal
		// happens to carry a deliberately crafted trailing space
		// elsewhere on the line.
		const result = arbiter.setLine(0, '- [ ] Child  ');

		expect(result).toBe('- [ ] Child  ');
	});
});

describe('LineWriteArbiter: removal stays blocked when verification could not be established', () => {
	it('blocks a removal proposal when the cursor line was edited in a way that also changed its bare text', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] Task prose \u{1F194} abc \u{1F4C5} 2025-01-01'];
		const target1 = createLineEditor(lines);
		arbiter.beginPass(target1, 0, 'file.md');
		arbiter.endPass();

		// The user selected the id plus surrounding prose and replaced it
		// all in one action: the id is gone AND the prose text changed,
		// but the due date is untouched. bareText mismatches, so
		// detectSuppression bails before verifying anything on this line.
		lines[0] = '- [ ] Task changed \u{1F4C5} 2025-01-01';
		const target2 = createLineEditor(lines);
		arbiter.beginPass(target2, 0, 'file.md');

		// A coincidental cleanup-pass proposal drops the due date too.
		// It must still be blocked: the due date was never positively
		// verified as untouched this pass, since the bareText mismatch
		// short-circuited detection entirely.
		const result = arbiter.setLine(0, '- [ ] Task changed');

		expect(result).toContain('\u{1F4C5} 2025-01-01');
	});

	it('blocks a removal proposal for a marker that only just appeared since the last snapshot', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] Task'];
		const target1 = createLineEditor(lines);
		arbiter.beginPass(target1, 0, 'file.md');
		arbiter.endPass(); // snapshot: id is absent on line 0

		// Something adds an id to the line without it ever being
		// suppressed or verified: the prior value was null, not a value
		// that changed.
		lines[0] = '- [ ] Task \u{1F194} abc';
		const target2 = createLineEditor(lines);
		arbiter.beginPass(target2, 0, 'file.md');
		expect(arbiter.isSuppressed(0, MarkerType.Id)).toBe(false);

		// A proposal now tries to drop that just-typed id. It must be
		// blocked, since the id was never verified as an untouched
		// carry-over from the prior snapshot (there was nothing to carry
		// over).
		const result = arbiter.setLine(0, '- [ ] Task');

		expect(result).toContain('\u{1F194} abc');
	});

	it('blocks a removal proposal for a sticky-suppressed marker even when its value transiently matches the snapshot again', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] Task \u{1F4C5} 2025-01-01'];
		const target1 = createLineEditor(lines);
		arbiter.beginPass(target1, 0, 'file.md');
		arbiter.endPass();

		// Pass 2: the due date is deleted; suppression engages.
		lines[0] = '- [ ] Task';
		const target2 = createLineEditor(lines);
		arbiter.beginPass(target2, 0, 'file.md');
		expect(arbiter.isSuppressed(0, MarkerType.Due)).toBe(true);

		// Pass 3: same cursor line, no endPass ran in between, so the
		// snapshot is untouched. Something other than the arbiter put
		// the date back on the line before this pass started. Suppression
		// from pass 2 must win over the transient value match, rather
		// than letting the match verify the marker as removable.
		lines[0] = '- [ ] Task \u{1F4C5} 2025-01-01';
		const target3 = createLineEditor(lines);
		arbiter.beginPass(target3, 0, 'file.md');
		expect(arbiter.isSuppressed(0, MarkerType.Due)).toBe(true);

		const result = arbiter.setLine(0, '- [ ] Task');

		expect(result).toBe('- [ ] Task \u{1F4C5} 2025-01-01');
	});

	it('does not let verification carry over from a previous pass once the reset at the top of beginPass runs', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] Task \u{1F194} abc'];
		const target1 = createLineEditor(lines);
		arbiter.beginPass(target1, 0, 'file.md');
		arbiter.endPass();

		// Pass N: the line is untouched this pass, so the id's value
		// matches the snapshot and gets verified.
		const target2 = createLineEditor(lines);
		arbiter.beginPass(target2, 0, 'file.md');
		expect(arbiter.isSuppressed(0, MarkerType.Id)).toBe(false);

		// Pass N+1: same cursor line, no endPass ran in between (so the
		// prior snapshot is still the original one), but an unrelated
		// prose edit changes the bare text, so this pass cannot verify
		// anything against that snapshot.
		lines[0] = '- [ ] Task changed \u{1F194} abc';
		const target3 = createLineEditor(lines);
		arbiter.beginPass(target3, 0, 'file.md');

		// If verification from pass N incorrectly carried over, this
		// removal would be let through. It must not be.
		const result = arbiter.setLine(0, '- [ ] Task changed');

		expect(result).toContain('\u{1F194} abc');
	});
});

describe('LineWriteArbiter: suppressed set lifecycle', () => {
	it('clears suppressed markers when the cursor moves to a different line', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] A \u{1F194} aaa', '- [ ] B'];
		const target1 = createLineEditor(lines);
		arbiter.beginPass(target1, 0, 'file.md');
		arbiter.endPass();

		lines[0] = '- [ ] A';
		const target2 = createLineEditor(lines);
		arbiter.beginPass(target2, 0, 'file.md');
		expect(arbiter.isSuppressed(0, MarkerType.Id)).toBe(true);

		// Caret moves to line 1.
		const target3 = createLineEditor(lines);
		arbiter.beginPass(target3, 1, 'file.md');

		const result = arbiter.setLine(1, '- [ ] B \u{1F194} bbb');
		expect(result).toBe('- [ ] B \u{1F194} bbb');
	});

	it('clears both snapshot and suppressed state when the file changes', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] A \u{1F194} aaa'];
		const target1 = createLineEditor(lines);
		arbiter.beginPass(target1, 0, 'fileA.md');
		arbiter.endPass();

		lines[0] = '- [ ] A';
		const target2 = createLineEditor(lines);
		arbiter.beginPass(target2, 0, 'fileA.md');
		expect(arbiter.isSuppressed(0, MarkerType.Id)).toBe(true);

		const otherLines = ['- [ ] X \u{1F194} aaa'];
		const target3 = createLineEditor(otherLines);
		arbiter.beginPass(target3, 0, 'fileB.md');

		expect(arbiter.isSuppressed(0, MarkerType.Id)).toBe(false);
	});

	it('accumulates suppression across several passes while the caret stays put', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] Task \u{1F4C5} 2025-01-01 \u{1F194} abc'];
		const target1 = createLineEditor(lines);
		arbiter.beginPass(target1, 0, 'file.md');
		arbiter.endPass();

		// First pass: user deletes the id only.
		lines[0] = '- [ ] Task \u{1F4C5} 2025-01-01';
		const target2 = createLineEditor(lines);
		arbiter.beginPass(target2, 0, 'file.md');
		expect(arbiter.isSuppressed(0, MarkerType.Id)).toBe(true);
		expect(arbiter.isSuppressed(0, MarkerType.Due)).toBe(false);

		// Second pass, same cursor line, no endPass in between: user now
		// also deletes the due date.
		lines[0] = '- [ ] Task';
		const target3 = createLineEditor(lines);
		arbiter.beginPass(target3, 0, 'file.md');

		expect(arbiter.isSuppressed(0, MarkerType.Id)).toBe(true);
		expect(arbiter.isSuppressed(0, MarkerType.Due)).toBe(true);
	});

	it('keeps a suppression sticky across passes even if the value transiently matches the snapshot again', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] Task \u{1F4C5} 2025-01-01'];
		const target1 = createLineEditor(lines);
		arbiter.beginPass(target1, 0, 'file.md');
		arbiter.endPass();

		// Pass 2: the due date is deleted; same cursor line as before.
		lines[0] = '- [ ] Task';
		const target2 = createLineEditor(lines);
		arbiter.beginPass(target2, 0, 'file.md');
		expect(arbiter.isSuppressed(0, MarkerType.Due)).toBe(true);

		// Pass 3: still the same cursor line, no endPass ran in between,
		// so the snapshot is untouched. Something other than the arbiter
		// put the date back on the line before this pass started. The
		// suppression from pass 2 must stay in force rather than being
		// wiped and silently re-derived as "not suppressed" just because
		// the cursor line argument did not change.
		lines[0] = '- [ ] Task \u{1F4C5} 2025-01-01';
		const target3 = createLineEditor(lines);
		arbiter.beginPass(target3, 0, 'file.md');
		expect(arbiter.isSuppressed(0, MarkerType.Due)).toBe(true);
	});
});

describe('LineWriteArbiter: setLine no-op writes', () => {
	it('does not call the target and returns the current line when correction produces no change', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] Task'];
		const target = createLineEditor(lines);
		arbiter.beginPass(target, 0, 'file.md');

		const result = arbiter.setLine(0, '- [ ] Task');

		expect(result).toBe('- [ ] Task');
		expect(target.setLine).not.toHaveBeenCalled();
	});

	it('does not otherwise touch a proposal when nothing needs to be restored or blocked', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] Task'];
		const target = createLineEditor(lines);
		arbiter.beginPass(target, 0, 'file.md');

		const result = arbiter.setLine(0, '- [ ] Task  ');

		expect(result).toBe('- [ ] Task  ');
	});
});

describe('LineWriteArbiter: out-of-range cursor line', () => {
	it('does not throw when the cursor line is beyond lineCount', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] A'];
		const target = createLineEditor(lines);

		expect(() => arbiter.beginPass(target, 999, 'file.md')).not.toThrow();
		expect(arbiter.isSuppressed(999, MarkerType.Id)).toBe(false);
	});

	it('does not treat a cursor line equal to lineCount as in range, even with a stale snapshot entry', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] A', '- [ ] B'];
		const target1 = createLineEditor(lines);
		arbiter.beginPass(target1, 1, 'file.md');
		arbiter.endPass(); // snapshot now has an entry for index 1

		// Line B (where the caret was) gets deleted; lineCount shrinks to
		// 1, but the stale snapshot entry for index 1 still sits in the
		// map until the next endPass rebuilds it. Index 1 is now exactly
		// equal to the new lineCount, i.e. one past the last valid line.
		lines.pop();
		const target2 = createLineEditor(lines);

		expect(() => arbiter.beginPass(target2, 1, 'file.md')).not.toThrow();
		expect(arbiter.isSuppressed(1, MarkerType.Id)).toBe(false);
	});
});

describe('LineWriteArbiter: scheduled and priority markers, not just due date', () => {
	it('suppresses a deleted scheduled date', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] Task \u23F3 2025-01-01'];
		const target1 = createLineEditor(lines);
		arbiter.beginPass(target1, 0, 'file.md');
		arbiter.endPass();

		lines[0] = '- [ ] Task';
		const target2 = createLineEditor(lines);
		arbiter.beginPass(target2, 0, 'file.md');

		expect(arbiter.isSuppressed(0, MarkerType.Scheduled)).toBe(true);

		const result = arbiter.setLine(0, '- [ ] Task \u23F3 2025-01-01');
		expect(result).toBe('- [ ] Task');
	});

	it('restores a scheduled date that was not touched', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] Task \u23F3 2025-01-01'];
		const target = createLineEditor(lines);
		arbiter.beginPass(target, 0, 'file.md');
		arbiter.endPass();
		arbiter.beginPass(target, 0, 'file.md');

		expect(arbiter.isSuppressed(0, MarkerType.Scheduled)).toBe(false);
	});

	it('suppresses a deleted priority marker', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] Task \u23EB'];
		const target1 = createLineEditor(lines);
		arbiter.beginPass(target1, 0, 'file.md');
		arbiter.endPass();

		lines[0] = '- [ ] Task';
		const target2 = createLineEditor(lines);
		arbiter.beginPass(target2, 0, 'file.md');

		expect(arbiter.isSuppressed(0, MarkerType.Priority)).toBe(true);

		const result = arbiter.setLine(0, '- [ ] Task \u23EB');
		expect(result).toBe('- [ ] Task');
	});
});

describe('LineWriteArbiter: indeterminate (mid-edit) cursor line', () => {
	it('reports the cursor line as indeterminate when a bare \u{1F194} glyph is left mid-deletion', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] Child \u{1F194}'];
		const target = createLineEditor(lines);
		arbiter.beginPass(target, 0, 'file.md');

		expect(arbiter.isIndeterminate(0)).toBe(true);
	});

	it('does not report indeterminate for a well-formed id', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] Child \u{1F194} abc'];
		const target = createLineEditor(lines);
		arbiter.beginPass(target, 0, 'file.md');

		expect(arbiter.isIndeterminate(0)).toBe(false);
	});

	it('does not report indeterminate when no marker glyph is present at all', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] Child'];
		const target = createLineEditor(lines);
		arbiter.beginPass(target, 0, 'file.md');

		expect(arbiter.isIndeterminate(0)).toBe(false);
	});

	it('refuses to write anything to an indeterminate cursor line, even an unrelated proposal', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] Child \u{1F194}'];
		const target = createLineEditor(lines);
		arbiter.beginPass(target, 0, 'file.md');

		const result = arbiter.setLine(0, '- [ ] Child \u{1F194} \u{1F194} xyz789');

		expect(result).toBe('- [ ] Child \u{1F194}');
		expect(target.setLine).not.toHaveBeenCalled();
	});

	it('reports indeterminate for a dependency list missing its first id (leading comma)', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] Parent \u26D4 ,def'];
		const target = createLineEditor(lines);
		arbiter.beginPass(target, 0, 'file.md');

		expect(arbiter.isIndeterminate(0)).toBe(true);
	});

	it('reports indeterminate for a dependency list missing its last id (trailing comma)', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] Parent \u26D4 abc,'];
		const target = createLineEditor(lines);
		arbiter.beginPass(target, 0, 'file.md');

		expect(arbiter.isIndeterminate(0)).toBe(true);
	});

	it('refuses a duplicate-marker write attempt on a mid-edit dependency list', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] Parent \u26D4 abc,'];
		const target = createLineEditor(lines);
		arbiter.beginPass(target, 0, 'file.md');

		const result = arbiter.setLine(0, '- [ ] Parent \u26D4 abc, \u26D4 childid');

		expect(result).toBe('- [ ] Parent \u26D4 abc,');
		expect(target.setLine).not.toHaveBeenCalled();
	});

	it('reports indeterminate for a partially typed due date', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] Task \u{1F4C5} 2025-0'];
		const target = createLineEditor(lines);
		arbiter.beginPass(target, 0, 'file.md');

		expect(arbiter.isIndeterminate(0)).toBe(true);
	});

	it('does not report indeterminate for lines other than the cursor line, even with the same fragment', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] A \u{1F194}', '- [ ] B \u{1F194}'];
		const target = createLineEditor(lines);
		arbiter.beginPass(target, 0, 'file.md');

		expect(arbiter.isIndeterminate(0)).toBe(true);
		expect(arbiter.isIndeterminate(1)).toBe(false);
	});

	it('still allows writes to other lines while the cursor line is indeterminate', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] Parent', '- [ ] Child \u{1F194}'];
		const target = createLineEditor(lines);
		arbiter.beginPass(target, 1, 'file.md');
		expect(arbiter.isIndeterminate(1)).toBe(true);

		const result = arbiter.setLine(0, '- [ ] Parent \u26D4 xyz');

		expect(result).toBe('- [ ] Parent \u26D4 xyz');
		expect(target.setLine).toHaveBeenCalledWith(0, '- [ ] Parent \u26D4 xyz');
	});

	it('does not throw and reports false for an out-of-range cursor line', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] A'];
		const target = createLineEditor(lines);

		expect(() => arbiter.beginPass(target, -1, 'file.md')).not.toThrow();
		expect(arbiter.isIndeterminate(-1)).toBe(false);
	});

	it('only retains the previous snapshot for the cursor line itself, not for other lines, while indeterminate', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] A \u{1F194} aaa', '- [ ] B \u{1F194} bbb'];
		const target1 = createLineEditor(lines);
		arbiter.beginPass(target1, 0, 'file.md');
		arbiter.endPass(); // both A and B captured with their ids present.

		// Pass 2: the caret moves to B, which is mid-deletion (indeterminate).
		// A's id is *also* removed in this same pass, by something other
		// than the arbiter (e.g. a cleanup pass acting on a different line
		// than the cursor). A is not the cursor line, so its snapshot must
		// still be rebuilt fresh from its current content, not retained
		// from before, even though the cursor line elsewhere is
		// indeterminate right now.
		lines[0] = '- [ ] A';
		lines[1] = '- [ ] B \u{1F194}';
		const target2 = createLineEditor(lines);
		arbiter.beginPass(target2, 1, 'file.md');
		expect(arbiter.isIndeterminate(1)).toBe(true);
		arbiter.endPass();

		// Pass 3: the caret moves to A. If A's snapshot was wrongly
		// retained from pass 1 (still showing id "aaa"), this would look
		// like the id was just deleted and get suppressed. It was not:
		// the id has been absent since pass 2, so there is nothing here
		// for this pass to suppress.
		const target3 = createLineEditor(lines);
		arbiter.beginPass(target3, 0, 'file.md');

		expect(arbiter.isSuppressed(0, MarkerType.Id)).toBe(false);
	});

	it('retains the last well-formed snapshot across an indeterminate pass, so suppression still engages once the deletion finishes', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] Task \u{1F194} abc'];
		const target1 = createLineEditor(lines);
		arbiter.beginPass(target1, 0, 'file.md');
		arbiter.endPass();

		// Mid-deletion: the glyph is left bare. This pass is
		// indeterminate, so nothing gets written, and endPass must not
		// overwrite the snapshot with this transient state.
		lines[0] = '- [ ] Task \u{1F194}';
		const target2 = createLineEditor(lines);
		arbiter.beginPass(target2, 0, 'file.md');
		expect(arbiter.isIndeterminate(0)).toBe(true);
		arbiter.endPass();

		// The deletion finishes: the glyph itself is gone too.
		lines[0] = '- [ ] Task';
		const target3 = createLineEditor(lines);
		arbiter.beginPass(target3, 0, 'file.md');

		expect(arbiter.isIndeterminate(0)).toBe(false);
		expect(arbiter.isSuppressed(0, MarkerType.Id)).toBe(true);
	});

	it('exposes the last well-formed dependency ids for an indeterminate cursor line, so cleanup passes can still treat them as referenced', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] Parent \u26D4 abc,def'];
		const target1 = createLineEditor(lines);
		arbiter.beginPass(target1, 0, 'file.md');
		arbiter.endPass();

		// First id deleted mid-edit, leaving a leading comma. The line
		// is indeterminate, but it used to reference both abc and def.
		lines[0] = '- [ ] Parent \u26D4 ,def';
		const target2 = createLineEditor(lines);
		arbiter.beginPass(target2, 0, 'file.md');
		expect(arbiter.isIndeterminate(0)).toBe(true);

		expect(arbiter.getFrozenDepsForIndeterminateLine()).toEqual(new Set(['abc', 'def']));
	});

	it('returns an empty set when the cursor line is not indeterminate, even though the snapshot holds real deps for it', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] Parent \u26D4 abc,def'];
		const target1 = createLineEditor(lines);
		arbiter.beginPass(target1, 0, 'file.md');
		arbiter.endPass(); // snapshot now holds {abc, def} as deps for line 0.

		// Same well-formed line, same cursor position: not indeterminate.
		const target2 = createLineEditor(lines);
		arbiter.beginPass(target2, 0, 'file.md');

		expect(arbiter.isIndeterminate(0)).toBe(false);
		expect(arbiter.getFrozenDepsForIndeterminateLine()).toEqual(new Set());
	});

	it('returns an empty set on the very first pass over an indeterminate line, since there is nothing to retain yet', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] Parent \u26D4 ,def'];
		const target = createLineEditor(lines);
		arbiter.beginPass(target, 0, 'file.md');

		expect(arbiter.isIndeterminate(0)).toBe(true);
		expect(arbiter.getFrozenDepsForIndeterminateLine()).toEqual(new Set());
	});

	it('exposes the last well-formed id for an indeterminate cursor line, so cleanup passes can still treat it as referenced', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] Task \u{1F194} abc123'];
		const target1 = createLineEditor(lines);
		arbiter.beginPass(target1, 0, 'file.md');
		arbiter.endPass();

		// Id deleted mid-edit, leaving the bare glyph.
		lines[0] = '- [ ] Task \u{1F194}';
		const target2 = createLineEditor(lines);
		arbiter.beginPass(target2, 0, 'file.md');
		expect(arbiter.isIndeterminate(0)).toBe(true);

		expect(arbiter.getFrozenIdForCursorLine()).toBe('abc123');
	});

	it('returns null when the cursor line is not indeterminate, even though the snapshot holds a real id for it', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] Task \u{1F194} abc123'];
		const target1 = createLineEditor(lines);
		arbiter.beginPass(target1, 0, 'file.md');
		arbiter.endPass();

		const target2 = createLineEditor(lines);
		arbiter.beginPass(target2, 0, 'file.md');

		expect(arbiter.isIndeterminate(0)).toBe(false);
		expect(arbiter.getFrozenIdForCursorLine()).toBeNull();
	});

	it('returns null on the very first pass over an indeterminate line, since there is nothing to retain yet', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] Task \u{1F194}'];
		const target = createLineEditor(lines);
		arbiter.beginPass(target, 0, 'file.md');

		expect(arbiter.isIndeterminate(0)).toBe(true);
		expect(arbiter.getFrozenIdForCursorLine()).toBeNull();
	});

	it('returns null when the frozen snapshot for the cursor line holds no id value at all', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] Parent \u26D4 abc,def'];
		const target1 = createLineEditor(lines);
		arbiter.beginPass(target1, 0, 'file.md');
		arbiter.endPass();

		// First id deleted mid-edit, leaving a leading comma. The line is
		// indeterminate because of the dependency fragment, but it never
		// had a \u{1F194} marker at all.
		lines[0] = '- [ ] Parent \u26D4 ,def';
		const target2 = createLineEditor(lines);
		arbiter.beginPass(target2, 0, 'file.md');
		expect(arbiter.isIndeterminate(0)).toBe(true);

		expect(arbiter.getFrozenIdForCursorLine()).toBeNull();
	});

	it('does not produce a frozen id from a non-cursor line carrying a bare id fragment, since protection stays cursor-scoped', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] Other \u{1F194}', '- [ ] Task \u{1F194} abc123'];
		const target = createLineEditor(lines);
		arbiter.beginPass(target, 1, 'file.md');

		expect(arbiter.isIndeterminate(0)).toBe(false);
		expect(arbiter.getFrozenIdForCursorLine()).toBeNull();
	});
});

describe('LineWriteArbiter: seedFromText', () => {
	it('fills the snapshot without writing anything', () => {
		const arbiter = createArbiter();
		arbiter.seedFromText('file.md', '- [ ] Task \u{1F194} abc');

		// First real pass ever run for this file: the marker was deleted
		// cold, before any beginPass/endPass cycle ran.
		const lines = ['- [ ] Task'];
		const target = createLineEditor(lines);
		arbiter.beginPass(target, 0, 'file.md');

		expect(arbiter.isSuppressed(0, MarkerType.Id)).toBe(true);
		expect(target.setLine).not.toHaveBeenCalled();
	});

	it('does not stomp a snapshot already primed by a real pass', () => {
		const arbiter = createArbiter();
		const lines = ['- [ ] Task \u{1F194} abc'];
		const target1 = createLineEditor(lines);
		arbiter.beginPass(target1, 0, 'file.md');
		arbiter.endPass();

		// A slow file-open read resolves late, after a real pass already
		// primed a fresher snapshot for this file.
		arbiter.seedFromText('file.md', '- [ ] Task');

		lines[0] = '- [ ] Task';
		const target2 = createLineEditor(lines);
		arbiter.beginPass(target2, 0, 'file.md');

		// The real snapshot (id present) still governs, not the stale seed.
		expect(arbiter.isSuppressed(0, MarkerType.Id)).toBe(true);
	});

	it('returns null and does not throw for getFrozenIdForCursorLine right after seeding, before any pass has established a cursor line', () => {
		const arbiter = createArbiter();
		arbiter.seedFromText('file.md', '- [ ] Task \u{1F194} abc123');

		expect(() => arbiter.getFrozenIdForCursorLine()).not.toThrow();
		expect(arbiter.getFrozenIdForCursorLine()).toBeNull();
	});
});
