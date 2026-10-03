import { FIELD_LABELS, STANDARD_FIELDS, displayValue, parseFieldLayout, visibleByDefault } from '../../core/fields';
import type { FieldLayout } from '../../core/fields';
import type { KitItem } from '../../core/types';
import type { NavigationSort } from './query';

const DEFAULT_FIND_FIELDS: FieldLayout = { shown: visibleByDefault(['status', 'project', 'due', 'owner']) };

export interface NavigationPreferences {
	readonly fields: FieldLayout;
	readonly filter: string;
	readonly sort: NavigationSort;
	readonly recentSort: NavigationSort;
}

function parseSort(raw: unknown, fallback: NavigationSort): NavigationSort {
	return raw === 'title' || raw === 'recent' || raw === 'relevance' ? raw : fallback;
}

export function parsePreferences(raw: unknown): NavigationPreferences {
	const value: Record<string, unknown> = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? { ...raw } : {};
	return {
		fields: parseFieldLayout(value.fields, DEFAULT_FIND_FIELDS),
		filter: typeof value.filter === 'string' ? value.filter : '',
		sort: parseSort(value.sort, 'relevance'),
		recentSort: parseSort(value.recentSort, 'recent'),
	};
}

export function fieldLabel(field: string): string {
	const standard = STANDARD_FIELDS.find((name) => name === field);
	return standard === undefined ? field : FIELD_LABELS[standard];
}

export function fieldValue(item: KitItem, field: string): string | null {
	if (field === 'status') return item.status;
	if (field === 'project') return item.projectLink;
	return displayValue(item.properties[field]);
}

export function availableFields(items: readonly KitItem[], layout: FieldLayout): string[] {
	return [...new Set([...layout.shown, ...STANDARD_FIELDS, ...items.flatMap((item) => Object.keys(item.properties)).sort()])];
}
