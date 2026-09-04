/**
 * Suppresses write-backs that would silently reintroduce a marker the
 * user just deleted on the line their caret sits in.
 *
 * The plugin recomputes markers on every debounced editor-change pass.
 * Without this arbiter, deleting an inherited `📅` (or `🆔`, `⏳`,
 * priority glyph, or `⛔` dependency) on the active line gets undone on
 * the very next pass, because nothing else remembers that the user just
 * removed it.
 *
 * The arbiter keeps a whole-document snapshot taken at the end of every
 * pass and compares it against the cursor line at the start of the
 * next one. A stored marker that is no longer present (or now holds a
 * different value) is suppressed for the rest of the time the caret
 * stays on that line: the plugin may still add or change other
 * markers, but it may never restore or overwrite the one the user
 * touched. The snapshot entry is only trusted when its marker-free
 * remainder still matches the current line, so a line whose content
 * changed (Enter splitting it, or the caret landing on a different
 * line after an insertion shifted indices) is treated as unknown
 * rather than misapplied.
 *
 * The same comparison also produces the opposite signal: a marker
 * whose value is unchanged from the prior snapshot is positively
 * verified as untouched by the user this pass. A cleanup pass's own
 * proposal to remove that marker (for example, dropping an id that
 * just became orphaned on the very line the caret sits on) is allowed
 * to go through, since the arbiter has proof the user did not delete
 * it themselves. Removal stays blocked whenever that proof is missing,
 * whether because there is no prior snapshot yet, the bareText
 * comparison could not be trusted this pass, or the marker only just
 * appeared since the last snapshot was taken.
 *
 * A second, cheaper protection sits alongside suppression: a marker
 * can be *mid-edit* rather than cleanly present or absent (a bare
 * `🆔` with the id text deleted, a `⛔` list missing an id between two
 * commas, a partial date). None of that parses, so `read` on it
 * returns null exactly like "no marker at all" would, and treating it
 * that way is what caused the plugin to mint a fresh id or restore a
 * dependency mid-backspace. Every {@link MarkerAccessor} and the
 * dependency accessor expose `hasFragment` for this: true when a
 * glyph is present but its value does not parse. Whenever the cursor
 * line is in this state, every write to it is refused outright rather
 * than reconciled, and `endPass` keeps the last well-formed snapshot
 * for that line instead of overwriting it with the fragment, so
 * suppression still engages correctly once the edit finishes.
 */

import { MarkerAccessorRegistry, MarkerType } from './marker-accessor';
import { LineSnapshotStore, type LineSnapshot } from './line-snapshot-store';
import type { LineEditor } from './types';

export class LineWriteArbiter implements LineEditor {
	private target!: LineEditor;
	private filePath: string | null = null;
	private cursorLine!: number;
	private suppressedTypes = new Set<MarkerType>();
	private suppressedDepIds = new Set<string>();
	/**
	 * True when the cursor line carries a marker glyph that is present
	 * but does not yet parse into a well-formed value: the user is
	 * mid-edit on it right now. While true, the arbiter refuses every
	 * write to that line instead of trying to reconcile a proposal
	 * against it, since there is no well-formed "current value" to
	 * reconcile against yet.
	 */
	private cursorLineIndeterminate!: boolean;
	/**
	 * Marker types (and, separately, dependency ids) positively confirmed
	 * as untouched by the user on the cursor line this pass: the prior
	 * snapshot's bareText matched the current line, and the value held
	 * the same non-null value it held last pass. A cleanup pass's own
	 * removal proposal for something in these sets is allowed through,
	 * unlike a proposal touching anything that is only suppressed or
	 * unverified. Reset at the top of every {@link beginPass} call, since
	 * verification is evidence for this pass only and must never persist
	 * across passes the way suppression does.
	 */
	private verifiedTypes = new Set<MarkerType>();
	private verifiedDepIds = new Set<string>();

	constructor(
		private readonly registry: MarkerAccessorRegistry,
		private readonly snapshotStore: LineSnapshotStore = new LineSnapshotStore(registry),
	) {}

	/**
	 * Called at the start of every pass. Rotates suppression state when
	 * the file or cursor line changed, then re-derives suppression and
	 * verification for the current cursor line from the snapshot taken
	 * at the end of the previous pass.
	 */
	beginPass(target: LineEditor, cursorLine: number, filePath: string): void {
		this.verifiedTypes = new Set();
		this.verifiedDepIds = new Set();
		this.target = target;
		if (filePath !== this.filePath) {
			this.filePath = filePath;
			this.snapshotStore.reset();
			this.suppressedTypes = new Set();
			this.suppressedDepIds = new Set();
		} else if (cursorLine !== this.cursorLine) {
			this.suppressedTypes = new Set();
			this.suppressedDepIds = new Set();
		}
		this.cursorLine = cursorLine;
		this.cursorLineIndeterminate = this.computeIndeterminate();
		this.detectSuppression();
	}

	private detectSuppression(): void {
		if (this.cursorLine >= this.target.lineCount()) {
			return;
		}
		const prior = this.snapshotStore.get(this.cursorLine);
		if (!prior) {
			return;
		}
		const currentLine = this.target.getLine(this.cursorLine);
		if (prior.bareText !== this.snapshotStore.computeBareText(currentLine)) {
			return;
		}
		this.detectSuppressedMarkers(prior, currentLine);
		this.detectSuppressedDeps(prior, currentLine);
	}


	/**
	 * True when the cursor line carries a glyph for some marker type
	 * (single-value or dependency) whose value does not fully parse.
	 * Computed fresh from the line's raw content on every pass, so it
	 * catches a mid-edit marker on the very first pass that sees it,
	 * without needing a prior snapshot to compare against.
	 */
	private computeIndeterminate(): boolean {
		if (this.cursorLine < 0 || this.cursorLine >= this.target.lineCount()) {
			return false;
		}
		const line = this.target.getLine(this.cursorLine);
		return (
			this.registry.markers.some((accessor) => accessor.hasFragment(line)) ||
			this.registry.dependency.hasFragment(line)
		);
	}

	/**
	 * A marker whose value changed since the prior snapshot is suppressed;
	 * one whose value is unchanged is verified as untouched instead. Both
	 * sets are consulted by the correction methods below, which always
	 * check suppression first and never look at verification once
	 * suppression already applies, so a marker cannot land in both sets
	 * with any observable effect.
	 */
	private detectSuppressedMarkers(prior: LineSnapshot, currentLine: string): void {
		for (const accessor of this.registry.markers) {
			const priorValue = prior.markers.get(accessor.type) ?? null;
			if (priorValue === null) {
				continue;
			}
			if (accessor.read(currentLine) !== priorValue) {
				this.suppressedTypes.add(accessor.type);
			} else {
				this.verifiedTypes.add(accessor.type);
			}
		}
	}

	private detectSuppressedDeps(prior: LineSnapshot, currentLine: string): void {
		const currentDeps = this.registry.dependency.read(currentLine);
		for (const depId of prior.deps) {
			if (!currentDeps.has(depId)) {
				this.suppressedDepIds.add(depId);
			} else {
				this.verifiedDepIds.add(depId);
			}
		}
	}

	lineCount(): number {
		return this.target.lineCount();
	}

	getLine(n: number): string {
		return this.target.getLine(n);
	}

	setLine(n: number, proposedText: string): string {
		if (n !== this.cursorLine) {
			return this.target.setLine(n, proposedText);
		}
		const current = this.target.getLine(n);
		if (this.cursorLineIndeterminate) {
			return current;
		}
		const corrected = this.correctProposal(current, proposedText);
		if (corrected === current) {
			return current;
		}
		return this.target.setLine(n, corrected);
	}

	/**
	 * Reconciles a proposed line against the current one, marker by
	 * marker: a suppressed marker is always frozen at its current value.
	 * A proposed removal that is not suppressed is blocked too, unless
	 * this pass positively verified the marker as untouched by the user
	 * (see {@link verifiedTypes}), in which case the removal is allowed
	 * to stand, e.g. a cleanup pass dropping an id that just became
	 * orphaned on the line the caret happens to sit on.
	 */
	private correctProposal(current: string, proposed: string): string {
		let corrected = proposed;
		for (const accessor of this.registry.markers) {
			const currentValue = accessor.read(current);
			const blocked = accessor.read(proposed) === null && !this.verifiedTypes.has(accessor.type);
			if (this.suppressedTypes.has(accessor.type) || blocked) {
				corrected =
					currentValue === null
						? accessor.remove(corrected)
						: accessor.apply(corrected, currentValue);
			}
		}
		return this.correctDeps(current, proposed, corrected);
	}

	private correctDeps(current: string, proposed: string, corrected: string): string {
		const currentDeps = this.registry.dependency.read(current);
		const proposedDeps = this.registry.dependency.read(proposed);
		const ids = new Set<string>([...currentDeps, ...proposedDeps, ...this.suppressedDepIds]);
		let result = corrected;
		for (const depId of ids) {
			const currentHas = currentDeps.has(depId);
			const dropsIt = currentHas && !proposedDeps.has(depId);
			const desired = this.desiredDepPresence(depId, currentHas, dropsIt);
			const has = this.registry.dependency.read(result).has(depId);
			if (desired && !has) {
				result = this.registry.dependency.apply(result, depId);
			} else if (!desired && has) {
				result = this.registry.dependency.remove(result, depId);
			}
		}
		return result;
	}

	/**
	 * A suppressed id is always frozen at its current presence. Otherwise,
	 * a removal proposed by a cleanup pass is blocked unless this pass
	 * positively verified the id as an untouched carry-over from the
	 * prior snapshot (see {@link verifiedDepIds}). Anything else feeding
	 * the id set this is called against (an add, or a keep) is always
	 * meant to be present here.
	 */
	private desiredDepPresence(depId: string, currentHas: boolean, proposalDropsIt: boolean): boolean {
		if (this.suppressedDepIds.has(depId)) {
			return currentHas;
		}
		if (proposalDropsIt) {
			return !this.verifiedDepIds.has(depId);
		}
		return true;
	}

	/** Rebuilds the whole-document snapshot from the pass that just ran. */
	endPass(): void {
		this.snapshotStore.rebuildAll(this.target, this.cursorLine, this.cursorLineIndeterminate);
	}

	/**
	 * Primes the snapshot for a file before any pass has run against it,
	 * so the very first edit after opening the file is protected. A
	 * no-op once a real pass already owns this file's state, so a slow
	 * read cannot stomp a fresher snapshot.
	 */
	seedFromText(filePath: string, text: string): void {
		if (this.filePath === filePath) {
			return;
		}
		this.filePath = filePath;
		this.snapshotStore.seed(text);
		this.suppressedTypes = new Set();
		this.suppressedDepIds = new Set();
	}

	isSuppressed(lineIndex: number, type: MarkerType): boolean {
		return lineIndex === this.cursorLine && this.suppressedTypes.has(type);
	}


	/**
	 * True when the given line is the cursor line and it is currently
	 * mid-edit (a marker glyph present but not yet parseable). Callers
	 * use this to skip an action entirely rather than let the arbiter
	 * silently refuse the write after the fact, since some side effects
	 * (like id allocation, or a write to a *different* line) happen
	 * before `setLine` is ever reached.
	 */
	isIndeterminate(lineIndex: number): boolean {
		return lineIndex === this.cursorLine && this.cursorLineIndeterminate;
	}


	/**
	 * The dependency ids the cursor line referenced before it became
	 * indeterminate, taken from the snapshot store's retained entry
	 * (see {@link LineSnapshotStore.rebuildAll}). Cleanup passes read
	 * the document's raw text to decide whether an id is still
	 * "referenced as a dependency" anywhere; while the cursor line's
	 * own dependency list is a mid-edit fragment (e.g. a leading or
	 * trailing comma), that raw text parses to no dependencies at all,
	 * which would make every id it used to reference look orphaned and
	 * get stripped from lines the user never touched. Callers union
	 * this set into whatever they treat as "still referenced" so those
	 * ids survive the edit. Returns an empty set when the cursor line
	 * is not indeterminate, or when there is no retained snapshot yet
	 * (the very first pass over a line that started out malformed has
	 * nothing well-formed to fall back on).
	 */
	getFrozenDepsForIndeterminateLine(): ReadonlySet<string> {
		if (!this.cursorLineIndeterminate) {
			return new Set();
		}
		return this.snapshotStore.get(this.cursorLine)?.deps ?? new Set();
	}

	/**
	 * The `\u{1F194}` value the cursor line held before it became
	 * indeterminate, taken from the snapshot store's retained entry (see
	 * {@link LineSnapshotStore.rebuildAll}). Mirrors
	 * {@link getFrozenDepsForIndeterminateLine}: while the cursor line's
	 * own `\u{1F194}` is a mid-edit fragment (the glyph present, its value
	 * not yet parseable), reading the document's live text for it returns
	 * null exactly like "no id at all" would, which would make a `\u26D4`
	 * elsewhere in the document that still references the line's last
	 * well-formed id look dangling and get stripped from a line the user
	 * never touched. Callers union this value into whatever they treat as
	 * "still a known id" so that reference survives the edit. Returns null
	 * when the cursor line is not indeterminate, or when there is no
	 * retained snapshot yet (the very first pass over a line that started
	 * out malformed, or a cold {@link seedFromText} start, has nothing
	 * well-formed to fall back on).
	 */
	getFrozenIdForCursorLine(): string | null {
		if (!this.cursorLineIndeterminate) {
			return null;
		}
		return this.snapshotStore.get(this.cursorLine)?.markers.get(MarkerType.Id) ?? null;
	}

	getSuppressedDepIds(): Set<string> {
		return new Set(this.suppressedDepIds);
	}
}
