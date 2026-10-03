import type { App, Plugin, TFile } from 'obsidian';
import type { KitSettings } from './settings';
import type { KitItem, KitKind } from './types';

/**
 * The only surface a feature may use to touch shared state.
 * Features must not import from another feature folder; they talk through this context.
 */
export interface KitContext {
	readonly app: App;
	readonly plugin: Plugin;
	settings(): KitSettings;
	readonly index: KitIndex;
	readonly writer: SafeWriter;
	/** Feature-owned settings blob (persisted in data.json under features[id]). */
	featureData(id: string): unknown;
	setFeatureData(id: string, value: unknown): Promise<void>;
	/** Add a section to the plugin's settings tab. `render` is called each time the tab is shown. */
	addSettingsSection(title: string, render: (containerEl: HTMLElement) => void): void;
}

export interface KitIndex {
	/** All opted-in notes under the root folder. Recomputed lazily after vault/metadata events. */
	items(): readonly KitItem[];
	byKind(kind: KitKind): readonly KitItem[];
	get(path: string): KitItem | null;
	/** Called after the index changed (debounced). Returns an unsubscribe function. */
	onChange(listener: () => void): () => void;
}

export interface CreateNoteRequest {
	/** Folder relative to the kit root, e.g. "Projects". */
	readonly folder: string;
	readonly title: string;
	readonly content: string;
	readonly extension?: 'md' | 'csv';
}

export interface SafeWriter {
	/** Creates a new file under the kit root. Never overwrites: picks "Title 2", "Title 3"... */
	createNote(request: CreateNoteRequest): Promise<TFile>;
	/** Updates frontmatter of an opted-in note under the root via FileManager.processFrontMatter. */
	updateFrontmatter(file: TFile, mutate: (frontmatter: Record<string, unknown>) => void): Promise<void>;
	/** True when the vault path is inside the configured root folder. */
	isInsideRoot(path: string): boolean;
}

export interface KitFeature {
	readonly id: string;
	/** Register commands, views, code-block processors, settings sections. Use plugin.register* so unload cleans up. */
	register(ctx: KitContext): void;
}
