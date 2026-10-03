import type { SectionHeadings } from './sections';
import { checkRootFolder } from './paths';

export interface KitSettings {
	/** Vault folder the kit reads from and writes into. Nothing outside it is indexed or written. */
	readonly rootFolder: string;
	readonly headings: SectionHeadings;
	/** Per-feature settings blobs, keyed by KitFeature.id. Each feature parses its own blob. */
	readonly features: Readonly<Record<string, unknown>>;
}

export const DEFAULT_SETTINGS: KitSettings = {
	rootFolder: 'Obtion',
	headings: { principle: 'Principle', todo: 'To do', done: 'Done', limits: 'Verification limits' },
	features: {},
};

function str(value: unknown, fallback: string): string {
	return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
}

function record(value: unknown): Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value) ? { ...value } : {};
}

export interface ParsedSettings {
	readonly settings: KitSettings;
	/** Set when the stored workspace folder was invalid and the default was used instead; shown to the user. */
	readonly rootError: string | null;
}

/** Boundary parser for data.json: unknown input in, a complete valid KitSettings out. */
export function parseSettings(raw: unknown): KitSettings {
	return parseSettingsChecked(raw).settings;
}

export function parseSettingsChecked(raw: unknown): ParsedSettings {
	const r = record(raw);
	const h = record(r.headings);
	const d = DEFAULT_SETTINGS.headings;
	const rootInput = typeof r.rootFolder === 'string' ? r.rootFolder : DEFAULT_SETTINGS.rootFolder;
	const root = checkRootFolder(rootInput);
	return {
		rootError: root.ok ? null : `"${rootInput}": ${root.error}`,
		settings: {
		rootFolder: root.ok ? root.root : DEFAULT_SETTINGS.rootFolder,
		headings: {
			principle: str(h.principle, d.principle),
			todo: str(h.todo, d.todo),
			done: str(h.done, d.done),
			limits: str(h.limits, d.limits),
		},
		features: record(r.features),
		},
	};
}
