import type { KitItem } from '../../core/types';

export interface NavigationQuery {
	readonly text: readonly string[];
	readonly kinds: readonly string[];
	readonly statuses: readonly string[];
	readonly projects: readonly string[];
	readonly open: boolean;
}

/** Quotes group phrases, including token values; an unfinished quote consumes the remainder. */
export function parseQuery(input: string): NavigationQuery {
	const tokens: string[] = [];
	let token = '';
	let quoted = false;
	for (const character of input.trim()) {
		if (character === '"') quoted = !quoted;
		else if (/\s/u.test(character) && !quoted) {
			if (token) tokens.push(token);
			token = '';
		} else token += character;
	}
	if (token) tokens.push(token);
	const text: string[] = [];
	const kinds: string[] = [];
	const statuses: string[] = [];
	const projects: string[] = [];
	let open = false;
	for (const raw of tokens) {
		const value = raw.toLowerCase();
		if (value.startsWith('kind:') && value.length > 5) kinds.push(value.slice(5));
		else if (value.startsWith('status:') && value.length > 7) statuses.push(value.slice(7));
		else if (value.startsWith('project:') && value.length > 8) projects.push(value.slice(8));
		else if (value === 'is:open') open = true;
		else text.push(value);
	}
	return { text, kinds, statuses, projects, open };
}

export function isOpen(item: KitItem): boolean {
	return !['done', 'dropped', 'archived', 'superseded'].includes(item.status?.toLowerCase().trim() ?? '');
}

function compareText(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

export function compareItems(a: KitItem, b: KitItem): number {
	return compareText(a.basename.toLowerCase(), b.basename.toLowerCase())
		|| compareText(a.basename, b.basename) || compareText(a.path, b.path);
}

function matchScore(haystack: string, needle: string): number {
	const text = haystack.toLowerCase();
	if (text.startsWith(needle)) return 300;
	let position = text.indexOf(needle);
	while (position >= 0) {
		const preceding = text[position - 1];
		if (preceding !== undefined && !/[\p{L}\p{N}]/u.test(preceding)) return 200;
		position = text.indexOf(needle, position + 1);
	}
	if (text.includes(needle)) return 100;
	// Phrases stay contiguous; unquoted single words may match a subsequence.
	if (/\s/u.test(needle)) return 0;
	let cursor = 0;
	for (const character of text) {
		if (character === needle[cursor]) cursor++;
		if (cursor === needle.length) return 25;
	}
	return 0;
}

export function scoreItem(item: KitItem, query: NavigationQuery): number | null {
	if (!query.kinds.every((kind) => item.kind === kind)
		|| !query.statuses.every((status) => item.status?.toLowerCase() === status)
		|| !query.projects.every((project) => item.projectLink?.toLowerCase().includes(project))
		|| (query.open && !isOpen(item))) return null;
	let total = 0;
	for (const term of query.text) {
		const score = Math.max(...[item.basename, item.status ?? '', item.projectLink ?? ''].map((value) => matchScore(value, term)));
		if (score === 0) return null;
		total += score;
	}
	return total;
}

export type NavigationSort = 'relevance' | 'title' | 'recent';

export function searchItems(items: readonly KitItem[], input: string, sort: NavigationSort = 'relevance'): KitItem[] {
	const query = parseQuery(input);
	const scored = items.flatMap((item) => {
		const score = scoreItem(item, query);
		return score === null ? [] : [{ item, score }];
	});
	return scored.sort((a, b) => {
		const primary = sort === 'recent' ? b.item.mtime - a.item.mtime : sort === 'relevance' ? b.score - a.score : 0;
		return primary || compareItems(a.item, b.item);
	}).map(({ item }) => item);
}

export function recentItems(items: readonly KitItem[]): KitItem[] {
	return searchItems(items, '', 'recent');
}

/** Context commands only use resolved, opted-in project notes. */
export function activeProject(items: readonly KitItem[], activePath: string | null): KitItem | null {
	const active = items.find((item) => item.path === activePath);
	if (!active) return null;
	if (active.kind === 'project') return active;
	return items.find((item) => item.path === active.projectPath && item.kind === 'project') ?? null;
}

export function nextOpenTask(items: readonly KitItem[], projectPath: string, activePath: string | null): KitItem | null {
	const tasks = items.filter((item) => item.kind === 'task' && item.projectPath === projectPath && isOpen(item)).sort(compareItems);
	if (tasks.length === 0) return null;
	const current = tasks.findIndex((item) => item.path === activePath);
	return tasks[(current + 1) % tasks.length] ?? null;
}
