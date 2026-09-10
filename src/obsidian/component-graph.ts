/**
 * Constructs the object graph the plugin runs on.
 *
 * `main.ts` owns the Obsidian lifecycle: gating on the Tasks plugin,
 * registering triggers, and dispatching the active editor. Everything
 * that lifecycle touches gets built here, once, and published as
 * readonly fields. A composition root that hides what it built forces
 * every consumer to reconstruct it, so this one hands out all of it.
 */

import type { VaultReader } from '../cache/cache-coordinator';
import { CacheCoordinator } from '../cache/cache-coordinator';
import { IdCache, DepCache } from '../cache/marker-cache';
import { MetadataSyncCache } from '../cache/metadata-sync-cache';
import { LineWriteArbiter } from '../editing/line-write-arbiter';
import { DependencyCleaner } from '../linking/dependency-cleaner';
import { IdGenerator } from '../linking/id-generator';
import { MetadataInheritor } from '../linking/metadata-inheritor';
import { TaskLinker } from '../linking/task-linker';
import { MarkerAccessorRegistry } from '../parsing/marker-accessor';
import { MarkerScanner } from '../parsing/marker-scanner';
import { RelationshipAnalyzer } from '../parsing/relationship-analyzer';
import { TaskMetadataParser } from '../parsing/task-metadata-parser';
import { TaskParser } from '../parsing/task-parser';
import type { IndentConfig } from '../parsing/task-parser';
import { CleanupPass } from '../processing/cleanup-pass';
import { EditorProcessor } from '../processing/editor-processor';
import { LinkPass } from '../processing/link-pass';

export class ComponentGraph {
	readonly idCache: IdCache;
	readonly depCache: DepCache;
	readonly syncCache: MetadataSyncCache;
	readonly coordinator: CacheCoordinator;
	readonly arbiter: LineWriteArbiter;
	readonly processor: EditorProcessor;

	constructor(vault: VaultReader, indent: IndentConfig) {
		const parser = new TaskParser(indent);
		const metadataParser = new TaskMetadataParser();
		const relAnalyzer = new RelationshipAnalyzer(parser);
		const registry = new MarkerAccessorRegistry(parser, metadataParser);
		const scanner = new MarkerScanner();

		this.syncCache = new MetadataSyncCache(parser, metadataParser, relAnalyzer);
		this.idCache = new IdCache(scanner);
		this.depCache = new DepCache(scanner);
		this.coordinator = new CacheCoordinator(
			this.idCache, this.depCache, this.syncCache, vault,
		);
		this.arbiter = new LineWriteArbiter(registry);

		const inheritor = new MetadataInheritor(registry, this.syncCache);
		const linker = new TaskLinker(parser, new IdGenerator(), relAnalyzer, inheritor);
		this.processor = new EditorProcessor(
			new LinkPass(linker, parser, this.idCache, this.arbiter),
			new CleanupPass(
				new DependencyCleaner(parser), parser, relAnalyzer,
				this.idCache, this.depCache, this.arbiter,
			),
			this.arbiter,
		);
	}
}
