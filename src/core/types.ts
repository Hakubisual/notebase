// Shared data model. Pure module: no runtime import from "obsidian" so it can be unit-tested with bun.

export const KIT_KINDS = ['project', 'task', 'decision', 'wiki', 'record'] as const;
export type KitKind = (typeof KIT_KINDS)[number];

/** Allowed `status` values per kind. The first entry is the default for new notes. */
export const STATUS_BY_KIND = {
	project: ['active', 'paused', 'done', 'dropped'],
	task: ['todo', 'doing', 'blocked', 'done', 'dropped'],
	decision: ['open', 'decided', 'superseded'],
	wiki: ['draft', 'published', 'archived'],
	record: ['active', 'archived'],
} as const satisfies Record<KitKind, readonly string[]>;

/** Frontmatter key that opts a note into the kit. Notes without it are never indexed or modified. */
export const KIT_KEY = 'kit';

export interface KitItem {
	/** Vault-relative path, e.g. "Obtion/Projects/Garden Planner.md". */
	readonly path: string;
	readonly basename: string;
	readonly kind: KitKind;
	/** Raw status string as written (may be outside STATUS_BY_KIND; callers decide how to show it). */
	readonly status: string | null;
	/** Link text from the `project` property, e.g. "Garden Planner" for "[[Garden Planner]]". */
	readonly projectLink: string | null;
	/** Resolved vault path of the linked project note, when Obsidian could resolve it. */
	readonly projectPath: string | null;
	/** All frontmatter properties, read-only snapshot. */
	readonly properties: Readonly<Record<string, unknown>>;
	readonly mtime: number;
}

export function isKitKind(value: unknown): value is KitKind {
	return typeof value === 'string' && (KIT_KINDS as readonly string[]).includes(value);
}

/** "[[Name|Alias]]" / "[[Name#Heading]]" / "Name" -> "Name". Returns null for empty or non-string input. */
export function parseLinkText(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	let text = value.trim();
	if (text.startsWith('[[') && text.endsWith(']]')) text = text.slice(2, -2);
	const cut = text.search(/[|#^]/);
	if (cut >= 0) text = text.slice(0, cut);
	text = text.trim();
	return text.length > 0 ? text : null;
}

export interface RawNote {
	readonly path: string;
	readonly basename: string;
	readonly mtime: number;
	readonly frontmatter: unknown;
}

/** Parse a note's frontmatter into a KitItem, or null if the note did not opt in with `kit: <kind>`. */
export function parseKitItem(note: RawNote, resolveLink: (link: string, sourcePath: string) => string | null): KitItem | null {
	const fm = note.frontmatter;
	if (typeof fm !== 'object' || fm === null || Array.isArray(fm)) return null;
	const properties: Record<string, unknown> = { ...fm };
	const kind = properties[KIT_KEY];
	if (!isKitKind(kind)) return null;
	const status = typeof properties.status === 'string' && properties.status.trim() !== '' ? properties.status.trim() : null;
	const projectLink = parseLinkText(properties.project);
	return {
		path: note.path,
		basename: note.basename,
		kind,
		status,
		projectLink,
		projectPath: projectLink === null ? null : resolveLink(projectLink, note.path),
		properties,
		mtime: note.mtime,
	};
}
