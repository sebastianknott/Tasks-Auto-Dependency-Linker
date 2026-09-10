/**
 * Owns the single whitespace rule that keeps every marker's apply/remove
 * round trip lossless. Every marker apply appends exactly one separator
 * space directly before its glyph, without touching whatever whitespace
 * the line already had. For the round trip `remove(apply(line, value))`
 * to reproduce `line` byte for byte, removal must therefore consume
 * exactly that one inserted separator character, never a whole run of
 * pre-existing whitespace. Centralising the rule here means every marker
 * remover shares one definition of "how much separator belongs to me",
 * instead of five independent, driftable implementations of trimEnd().
 */
export class LineSplicer {
	/**
	 * Removes the text in the half-open range `[start, end)` from `line`,
	 * joining what remains on either side. No trimming is applied on top:
	 * when `start` already points at the separator a marker's own regex
	 * captured (via a leading `\s?`), the regex has already decided how
	 * much separator whitespace belongs to the match, and slicing alone
	 * is correct. Applying any further trim here would eat whitespace the
	 * regex deliberately left alone, whether that is the user's own
	 * trailing space or unrelated content after the match.
	 */
	static spliceOut(line: string, start: number, end: number): string {
		return line.slice(0, start) + line.slice(end);
	}

	/**
	 * Drops exactly one trailing whitespace character from `text`, if one
	 * is present. Used when a marker's own matching regex does not
	 * capture its leading separator (the dependency marker's `⛔` glyph
	 * has no `\s?` in front of it), so the separator that apply inserted
	 * must be shed manually. Removing more than one character here would
	 * reach past the single space apply added and destroy whitespace the
	 * user typed on purpose.
	 */
	static dropSeparatorBefore(text: string): string {
		return /\s$/.test(text) ? text.slice(0, -1) : text;
	}
}
