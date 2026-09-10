/**
 * Vault-wide unique ID generation for the Tasks Auto-Dependency Linker plugin.
 *
 * Generates 6-character lowercase alphanumeric IDs and ensures vault-wide
 * uniqueness by checking against a set of existing IDs.
 */

/** Characters used for ID generation: a-z, 0-9. */
const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Generates unique 6-char alphanumeric IDs.
 *
 * Each instance is stateless. The caller supplies the set of IDs
 * already in use, so this class never needs to know where those IDs
 * came from.
 */
export class IdGenerator {
	/** Generates a random 6-character lowercase alphanumeric ID. */
	generateId(): string {
		let id = '';
		for (let i = 0; i < 6; i++) {
			id += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)]!;
		}
		return id;
	}

	/**
	 * Generates an ID guaranteed not to exist in the provided set.
	 *
	 * Retries if a collision occurs (astronomically unlikely with
	 * 2.18 billion combinations).
	 */
	generateUniqueId(existingIds: ReadonlySet<string>): string {
		let id = this.generateId();
		while (existingIds.has(id)) {
			id = this.generateId();
		}
		return id;
	}
}
