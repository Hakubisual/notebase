import { parseLinkText, isKitKind } from '../../core/types';
import type { KitItem, KitKind } from '../../core/types';

export interface RelationLink {
	readonly target: string;
	readonly label: string;
}

export interface RelationEntry extends RelationLink {
	readonly item: KitItem | null;
}

export interface RelationGroup {
	readonly property: string;
	readonly entries: readonly RelationEntry[];
}

export type ResolveRelation = (target: string, sourcePath: string) => string | null;

/** Only complete wikilink values are relations; ordinary text is never a link. */
export function extractLinks(value: unknown): RelationLink[] {
	const values: readonly unknown[] = Array.isArray(value) ? value : [value];
	const result = new Map<string, RelationLink>();
	for (const part of values) {
		if (typeof part !== 'string') continue;
		const match = /^\[\[([^\]\r\n[]+)\]\]$/.exec(part.trim());
		if (!match?.[1]) continue;
		const target = parseLinkText(part);
		if (target === null) continue;
		const alias = match[1].split('|')[1]?.trim();
		if (!result.has(target)) result.set(target, { target, label: alias || target });
	}
	return [...result.values()];
}

/** Pure fallback for callers without a vault resolver: ambiguous names stay unresolved. */
export function resolveInItems(items: readonly KitItem[], target: string, sourcePath: string): string | null {
	const path = target.replace(/\.md$/i, '');
	const folder = sourcePath.slice(0, sourcePath.lastIndexOf('/') + 1);
	const exact = items.find((item) => item.path.replace(/\.md$/i, '') === path);
	if (exact) return exact.path;
	const relative = items.find((item) => item.path.replace(/\.md$/i, '') === folder + path);
	if (relative) return relative.path;
	const matches = items.filter((item) => item.basename === path || item.path.replace(/\.md$/i, '').endsWith('/' + path));
	return matches.length === 1 ? matches[0]?.path ?? null : null;
}

export function outgoingRelations(note: KitItem, items: readonly KitItem[], resolve: ResolveRelation): RelationGroup[] {
	const byPath = new Map(items.map((item) => [item.path, item]));
	return Object.entries(note.properties).flatMap(([property, value]) => {
		const entries = new Map<string, RelationEntry>();
		for (const link of extractLinks(value)) {
			const path = resolve(link.target, note.path);
			const item = path === null ? null : byPath.get(path) ?? null;
			const key = item?.path ?? link.target;
			if (!entries.has(key)) entries.set(key, { ...link, item });
		}
		return entries.size > 0 ? [{ property, entries: [...entries.values()] }] : [];
	});
}

export function incomingRelations(notePath: string, items: readonly KitItem[], resolve: ResolveRelation): RelationGroup[] {
	const groups = new Map<string, RelationEntry[]>();
	for (const item of items) {
		if (item.path === notePath) continue;
		for (const [property, value] of Object.entries(item.properties)) {
			if (!extractLinks(value).some((link) => resolve(link.target, item.path) === notePath)) continue;
			const entries = groups.get(property) ?? [];
			entries.push({ target: item.path, label: item.basename, item });
			groups.set(property, entries);
		}
	}
	return [...groups].map(([property, entries]) => ({ property, entries }));
}

export interface Rollup {
	readonly total: number;
	readonly counts: readonly { readonly status: string | null; readonly count: number }[];
	readonly percentDone: number | null;
}

export function rollup(items: readonly KitItem[]): Rollup {
	const unique = new Map(items.map((item) => [item.path, item]));
	const counts = new Map<string | null, number>();
	for (const item of unique.values()) counts.set(item.status, (counts.get(item.status) ?? 0) + 1);
	return {
		total: unique.size,
		counts: [...counts].map(([status, count]) => ({ status, count })),
		percentDone: unique.size === 0 ? null : (counts.get('done') ?? 0) * 100 / unique.size,
	};
}

export interface RollupConfig {
	readonly property: string;
	readonly kind: KitKind | null;
}

export function incomingRollup(notePath: string, items: readonly KitItem[], resolve: ResolveRelation, config: RollupConfig): Rollup {
	const group = incomingRelations(notePath, items, resolve).find((candidate) => candidate.property === config.property);
	const related = (group?.entries ?? []).flatMap((entry) => entry.item && (config.kind === null || entry.item.kind === config.kind) ? [entry.item] : []);
	return rollup(related);
}

export function parseRollupConfig(source: string): RollupConfig | string {
	let property = 'project';
	let kind: KitKind | null = null;
	const seen = new Set<string>();
	for (const line of source.split(/\r?\n/)) {
		if (!line.trim() || line.trim().startsWith('#')) continue;
		const match = /^\s*(property|kind)\s*:\s*(.*?)\s*$/.exec(line);
		if (!match?.[1] || !match[2]) return 'Use property: project and optionally kind: task.';
		const [, key, value] = match;
		if (seen.has(key)) return `Duplicate setting: ${key}`;
		seen.add(key);
		if (key === 'property') property = value;
		else if (isKitKind(value)) kind = value;
		else return 'Kind must be project, task, decision, wiki, or record.';
	}
	return { property, kind };
}
