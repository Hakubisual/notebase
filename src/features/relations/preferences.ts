import { FIELD_LABELS, STANDARD_FIELDS, displayValue, parseFieldLayout, visibleByDefault } from '../../core/fields';
import type { FieldLayout } from '../../core/fields';
import { isKitKind } from '../../core/types';
import type { KitItem, KitKind } from '../../core/types';
import type { RelationEntry } from './model';

export interface PanelPreferences {
	readonly layout: FieldLayout;
	readonly filter: string;
	readonly kind: KitKind | null;
	readonly sort: 'title' | 'status' | 'due';
}

export function fieldNames(items: readonly KitItem[]): string[] {
	return [...new Set<string>([...STANDARD_FIELDS, ...items.flatMap((item) => Object.keys(item.properties)).filter((field) => field !== 'position')])];
}

export function fieldLabel(field: string): string {
	for (const standard of STANDARD_FIELDS) if (standard === field) return FIELD_LABELS[standard];
	return field;
}

export function parsePanelPreferences(raw: unknown, fields: readonly string[]): PanelPreferences {
	const data = typeof raw === 'object' && raw !== null ? raw : {};
	const layout = 'layout' in data ? data.layout : undefined;
	const filter = 'filter' in data && typeof data.filter === 'string' ? data.filter : '';
	const kind = 'kind' in data && isKitKind(data.kind) ? data.kind : null;
	const sort = 'sort' in data && (data.sort === 'status' || data.sort === 'due') ? data.sort : 'title';
	const compact = ['status', 'due', 'owner'].filter((field) => visibleByDefault(fields).includes(field));
	return { layout: parseFieldLayout(layout, { shown: compact }), filter, kind, sort };
}

export function panelData(raw: unknown): unknown {
	return typeof raw === 'object' && raw !== null && 'panel' in raw ? raw.panel : undefined;
}

export function withPanelData(raw: unknown, panel: PanelPreferences): Record<string, unknown> {
	return { ...(typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {}), panel };
}

export function arrangeEntries(entries: readonly RelationEntry[], prefs: PanelPreferences): RelationEntry[] {
	const query = prefs.filter.trim().toLocaleLowerCase();
	return entries.filter((entry) => {
		if (prefs.kind !== null && entry.item?.kind !== prefs.kind) return false;
		const text = [entry.label, ...prefs.layout.shown.map((field) => displayValue(entry.item?.properties[field]) ?? '')].join(' ').toLocaleLowerCase();
		return text.includes(query);
	}).sort((a, b) => {
		const value = (entry: RelationEntry): string | null => prefs.sort === 'title' ? entry.label : displayValue(entry.item?.properties[prefs.sort]);
		const left = value(a);
		const right = value(b);
		if (left === null && right !== null) return 1;
		if (right === null && left !== null) return -1;
		return (left ?? '').localeCompare(right ?? '') || a.label.localeCompare(b.label) || a.target.localeCompare(b.target);
	});
}
