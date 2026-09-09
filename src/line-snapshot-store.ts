/**
 * Owns the whole-document snapshot mechanics that {@link LineWriteArbiter}
 * builds its suppression and verification policy on top of. A snapshot
 * entry records, for one line, its marker-free "bare text" and the value
 * every marker (single-value or dependency) held the last time a pass
 * finished, so a later pass can tell whether the line changed and, if so,
 * exactly what changed on it.
 *
 * This class is pure mechanics: it knows how to build, store, retrieve,
 * and rebuild snapshot entries. It holds no opinion on what a changed
 * value should mean (suppression, verification, freezing a write); that
 * policy lives entirely in {@link LineWriteArbiter}.
 */

import { MarkerAccessorRegistry, MarkerType } from './marker-accessor';
import type { LineEditor } from './types';

export interface LineSnapshot {
	readonly bareText: string;
	readonly markers: ReadonlyMap<MarkerType, string | null>;
	readonly deps: ReadonlySet<string>;
}

export class LineSnapshotStore {
	private snapshot = new Map<number, LineSnapshot>();

	constructor(private readonly registry: MarkerAccessorRegistry) {}

	/** The snapshot entry for a line, or undefined if none has been captured yet. */
	get(lineIndex: number): LineSnapshot | undefined {
		return this.snapshot.get(lineIndex);
	}

	/** Discards every snapshot entry, e.g. when the arbiter switches to a new file. */
	reset(): void {
		this.snapshot = new Map();
	}

	/**
	 * Rebuilds the whole-document snapshot from the pass that just ran.
	 * The cursor line keeps its last well-formed snapshot instead of
	 * being overwritten while mid-edit: storing the fragment itself
	 * would make the *next* pass's `bareText` comparison start from a
	 * fragment too, so a completed deletion would look like "no prior
	 * value" instead of correctly triggering suppression. Falls back to
	 * building fresh only when there is nothing to retain yet (a file
	 * opened with pre-existing malformed content, before any pass ever
	 * saw it well-formed).
	 */
	rebuildAll(target: LineEditor, cursorLine: number, cursorLineIndeterminate: boolean): void {
		const rebuilt = new Map<number, LineSnapshot>();
		const count = target.lineCount();
		for (let i = 0; i < count; i++) {
			rebuilt.set(i, this.snapshotForRebuild(target, i, cursorLine, cursorLineIndeterminate));
		}
		this.snapshot = rebuilt;
	}

	private snapshotForRebuild(
		target: LineEditor,
		lineIndex: number,
		cursorLine: number,
		cursorLineIndeterminate: boolean,
	): LineSnapshot {
		if (lineIndex === cursorLine && cursorLineIndeterminate) {
			const previous = this.snapshot.get(lineIndex);
			if (previous) {
				return previous;
			}
		}
		return this.buildSnapshot(target.getLine(lineIndex));
	}

	/**
	 * Primes the snapshot for a file from its raw text, before any pass
	 * has run against it, so the very first edit after opening the file
	 * is protected.
	 */
	seed(text: string): void {
		const rebuilt = new Map<number, LineSnapshot>();
		text.split('\n').forEach((line, i) => rebuilt.set(i, this.buildSnapshot(line)));
		this.snapshot = rebuilt;
	}

	private buildSnapshot(line: string): LineSnapshot {
		const markers = new Map<MarkerType, string | null>();
		for (const accessor of this.registry.markers) {
			markers.set(accessor.type, accessor.read(line));
		}
		return {
			bareText: this.computeBareText(line),
			markers,
			deps: this.registry.dependency.read(line),
		};
	}

	/** The line with every marker (single-value and dependency) stripped out. */
	computeBareText(line: string): string {
		let bare = line;
		for (const accessor of this.registry.markers) {
			bare = accessor.remove(bare);
		}
		for (const depId of this.registry.dependency.read(bare)) {
			bare = this.registry.dependency.remove(bare, depId);
		}
		// Every catch-all below exists for the same reason: a marker
		// mid-deletion (glyph left, value text gone or incomplete) does not
		// parse, so the loop above is a no-op for it and the fragment would
		// otherwise make this transient state look structurally different
		// from the prior snapshot, silently skipping suppression detection
		// for the rest of the line. \s* (not \s?) on the outer edges so any
		// run of whitespace collapsed around a stripped fragment is still
		// swallowed in one pass, not left as a leftover double space.
		//
		// Dependency: a bare ⛔ with the id text gone.
		bare = bare.replace(/\s*\u26D4\s*/g, ' ');
		// Id: TaskParser.ID_REGEX accepts any [a-zA-Z0-9_-]+ right after
		// "🆔 ", so any id text that parses at all was already stripped by
		// remove() above. The only fragment an id marker can ever leave
		// behind is therefore a bare glyph, unlike the date markers below;
		// a charset-aware partial-value strip would be dead weight here.
		bare = bare.replace(/\s*\u{1F194}\s*/gu, ' ');
		// Due: a bare glyph, or a glyph followed by a partial YYYY-MM-DD run
		// (e.g. "📅 2026-0"). removeDueDate only matches a complete date, so
		// a truncated one survives it untouched. The inner \s? (single, not
		// \s*) matches at most the one space the glyph and date are
		// normally separated by; it is not meant to collapse a run, unlike
		// the outer \s* on both edges of the whole fragment.
		bare = bare.replace(/\s*[\u{1F4C5}\u{1F4C6}\u{1F5D3}]\s?[\d-]*\s*/gu, ' ');
		// Scheduled: same shape as due, for the scheduled glyphs.
		bare = bare.replace(/\s*[\u{23F3}\u{231B}]\s?[\d-]*\s*/gu, ' ');
		// Deliberately no priority fallback: PriorityAccessor.hasFragment is
		// hardcoded false, since a priority glyph is a single code point and
		// can never be partially typed, so remove() above always strips it
		// cleanly. A catch-all here would never change its input: a no-op
		// replace with no way to ever fire, which is exactly the shape of an
		// untestable, un-killable mutant, not a safety net.
		return bare.trim();
	}
}
