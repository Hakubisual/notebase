import { displayValue, FIELD_LABELS, parseFieldLayout, STANDARD_FIELDS, visibleByDefault } from '../../core/fields';
import type { FieldLayout } from '../../core/fields';
import type { KitItem } from '../../core/types';
import { compareNodes } from './hierarchy';
import type { WikiNode } from './hierarchy';

export interface WikiPreferences {
	readonly layout: FieldLayout;
	readonly status: string;
	readonly sort: 'ascending' | 'descending';
	readonly collapsed: readonly string[];
}

export interface WikiData {
	readonly tree: WikiPreferences;
	readonly children: WikiPreferences;
}

function record(raw: unknown): Record<string, unknown> {
	return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? { ...raw } : {};
}

export function parsePreferences(raw: unknown): WikiPreferences {
	const value = record(raw);
	return {
		layout: parseFieldLayout(value.layout, { shown: visibleByDefault(['status']) }),
		status: typeof value.status === 'string' ? value.status : '',
		sort: value.sort === 'descending' ? 'descending' : 'ascending',
		collapsed: Array.isArray(value.collapsed) ? [...new Set(value.collapsed.filter((path): path is string => typeof path === 'string'))] : [],
	};
}

export function parseWikiData(raw: unknown): WikiData {
	const value = record(raw);
	return { tree: parsePreferences(value.tree), children: parsePreferences(value.children) };
}

export function fieldLabel(field: string): string {
	const standard = STANDARD_FIELDS.find((key) => key === field);
	return standard ? FIELD_LABELS[standard] : field;
}

export function fieldValue(item: KitItem, field: string): string | null {
	return displayValue(field === 'status' ? item.status : item.properties[field]);
}

/** Keep ancestors for context when a descendant matches the status filter. */
export function visiblePaths(nodes: readonly WikiNode[], status: string): ReadonlySet<string> {
	const allowed = new Set(nodes.map((node) => node.item.path));
	const visible = new Set<string>();
	for (const node of nodes) {
		if (status !== '' && node.item.status !== status) continue;
		let current: WikiNode | null = node;
		while (current && allowed.has(current.item.path) && !visible.has(current.item.path)) {
			visible.add(current.item.path);
			current = current.parent;
		}
	}
	return visible;
}

export function sortedNodes(nodes: readonly WikiNode[], sort: WikiPreferences['sort']): WikiNode[] {
	return [...nodes].sort((a, b) => (sort === 'ascending' ? 1 : -1) * compareNodes(a, b));
}
