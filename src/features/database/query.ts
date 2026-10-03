import { displayValue, parseFieldLayout, visibleByDefault, type FieldLayout } from '../../core/fields';
import { builtinTemplate, renderTemplate } from '../../core/templates';
import type { SectionHeadings } from '../../core/sections';
import { isKitKind, STATUS_BY_KIND, type KitItem, type KitKind } from '../../core/types';

export type DbScalar = string | number | boolean | null;
export type DbFilter =
	| { readonly property: string; readonly op: 'equals'; readonly value: DbScalar }
	| { readonly property: string; readonly op: 'in'; readonly value: readonly DbScalar[] }
	| { readonly property: string; readonly op: 'contains'; readonly value: string }
	| { readonly property: string; readonly op: 'empty' };

export interface DbSort {
	readonly property: string;
	readonly direction: 'asc' | 'desc';
}

export interface DbQuery {
	readonly kind: KitKind;
	readonly layout: 'table' | 'board' | 'gallery';
	readonly filter: readonly DbFilter[];
	readonly sort: readonly DbSort[];
	readonly groupBy: string;
	readonly columns: readonly string[];
	readonly cover: string | null;
}

export class DbConfigError extends Error {
	constructor(readonly field: string, message: string) {
		super(`${field}: ${message}`);
		this.name = 'DbConfigError';
	}
}

const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const READ_ONLY_KEYS = new Set(['kit', 'name', 'path', 'position']);

export function canEditProperty(property: string): boolean {
	return !UNSAFE_KEYS.has(property) && !READ_ONLY_KEYS.has(property);
}

function object(raw: unknown, field: string): Record<string, unknown> {
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
		throw new DbConfigError(field, 'Expected an object');
	}
	return { ...raw };
}

function property(raw: unknown, field: string): string {
	if (typeof raw !== 'string' || raw.trim() === '' || /[\r\n\0]/.test(raw) || UNSAFE_KEYS.has(raw.trim())) {
		throw new DbConfigError(field, 'Expected a non-empty property name');
	}
	return raw.trim();
}

function scalar(raw: unknown): raw is DbScalar {
	return raw === null || typeof raw === 'string' || typeof raw === 'boolean' || (typeof raw === 'number' && Number.isFinite(raw));
}

function keys(raw: Record<string, unknown>, allowed: readonly string[], field: string): void {
	for (const key of Object.keys(raw)) {
		if (!allowed.includes(key)) throw new DbConfigError(field, `Unknown option "${key}"`);
	}
}

function parseFilter(raw: unknown): DbFilter {
	const r = object(raw, 'filter');
	keys(r, ['property', 'op', 'value'], 'filter');
	const p = property(r.property, 'filter.property');
	switch (r.op) {
		case 'equals':
			if (!scalar(r.value)) throw new DbConfigError('filter.value', 'Expected a scalar');
			return { property: p, op: 'equals', value: r.value };
		case 'in': {
			const values: unknown = r.value;
			if (!Array.isArray(values) || !values.every(scalar)) throw new DbConfigError('filter.value', 'Expected a list of scalars');
			return { property: p, op: 'in', value: values };
		}
		case 'contains':
			if (typeof r.value !== 'string') throw new DbConfigError('filter.value', 'Expected text');
			return { property: p, op: 'contains', value: r.value };
		case 'empty':
			if ('value' in r) throw new DbConfigError('filter.value', 'Empty does not take a value');
			return { property: p, op: 'empty' };
		default:
			throw new DbConfigError('filter.op', 'Use equals, in, contains or empty');
	}
}

function parseSort(raw: unknown): DbSort {
	const r = object(raw, 'sort');
	keys(r, ['property', 'direction'], 'sort');
	const direction = r.direction ?? 'asc';
	if (direction !== 'asc' && direction !== 'desc') throw new DbConfigError('sort.direction', 'Use asc or desc');
	return { property: property(r.property, 'sort.property'), direction };
}

function list(raw: unknown, field: string): readonly unknown[] {
	if (raw === undefined) return [];
	if (!Array.isArray(raw)) throw new DbConfigError(field, 'Expected a list');
	return raw;
}

/** The pure boundary accepts objects only. YAML decoding belongs to the Obsidian adapter. */
export function parseDbQuery(raw: unknown): DbQuery {
	const r = object(raw, 'query');
	keys(r, ['kind', 'layout', 'filter', 'sort', 'groupBy', 'columns', 'cover'], 'query');
	const kind = r.kind ?? 'task';
	if (!isKitKind(kind)) throw new DbConfigError('kind', 'Use project, task, decision, wiki or record');
	const layout = r.layout ?? 'table';
	if (layout !== 'table' && layout !== 'board' && layout !== 'gallery') throw new DbConfigError('layout', 'Use table, board or gallery');
	const defaults = visibleByDefault(kind === 'project' ? ['status', 'due', 'owner'] : ['status', 'project', 'due', 'owner']);
	const columns = r.columns === undefined ? (layout === 'gallery' ? defaults.slice(0, 3) : defaults) :
		list(r.columns, 'columns').map((v) => property(v, 'columns'));
	return {
		kind, layout,
		filter: list(r.filter, 'filter').map(parseFilter),
		sort: list(r.sort, 'sort').map(parseSort),
		groupBy: r.groupBy === undefined ? 'status' : property(r.groupBy, 'groupBy'),
		columns: [...new Set(columns.filter((p) => p !== 'name'))],
		cover: r.cover === undefined || r.cover === null ? null : property(r.cover, 'cover'),
	};
}

export function itemValue(item: KitItem, key: string): unknown {
	switch (key) {
		case 'name': return item.basename;
		case 'path': return item.path;
		case 'kit': return item.kind;
		case 'status': return item.status;
		default: return Object.prototype.hasOwnProperty.call(item.properties, key) ? item.properties[key] : undefined;
	}
}

function matches(item: KitItem, filter: DbFilter): boolean {
	const value = itemValue(item, filter.property);
	switch (filter.op) {
		case 'equals': return (value ?? null) === filter.value;
		case 'in': return filter.value.some((candidate) => (value ?? null) === candidate);
		case 'contains': return typeof value === 'string' ? value.includes(filter.value) :
			Array.isArray(value) && value.some((entry: unknown) => entry === filter.value);
		case 'empty': return value === undefined || value === null || value === '' ||
			(typeof value === 'string' && value.trim() === '') || (Array.isArray(value) && value.length === 0);
		default: { const unreachable: never = filter; return unreachable; }
	}
}

function compareText(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }

export function applyQuery(items: readonly KitItem[], query: DbQuery): KitItem[] {
	return items.filter((item) => item.kind === query.kind && query.filter.every((f) => matches(item, f))).sort((a, b) => {
		for (const sort of query.sort) {
			const av = itemValue(a, sort.property);
			const bv = itemValue(b, sort.property);
			const at = displayValue(av);
			const bt = displayValue(bv);
			// Missing values sort last in either direction, without fabricating data.
			if (at === null && bt !== null) return 1;
			if (bt === null && at !== null) return -1;
			const order = typeof av === 'number' && typeof bv === 'number' ? av - bv : compareText(at ?? '', bt ?? '');
			if (order !== 0) return sort.direction === 'asc' ? order : -order;
		}
		return (query.sort.length === 0 ? compareText(a.basename, b.basename) : 0) || compareText(a.path, b.path);
	});
}

export interface DbGroup {
	readonly value: string | null;
	readonly items: readonly KitItem[];
}

export function groupItems(items: readonly KitItem[], query: DbQuery): DbGroup[] {
	const groups = new Map<string | null, KitItem[]>();
	if (query.groupBy === 'status') for (const status of STATUS_BY_KIND[query.kind]) groups.set(status, []);
	for (const item of items) {
		const value = displayValue(itemValue(item, query.groupBy));
		const group = groups.get(value);
		if (group) group.push(item);
		else groups.set(value, [item]);
	}
	const known: readonly string[] = query.groupBy === 'status' ? STATUS_BY_KIND[query.kind] : [];
	return [...groups].sort(([a], [b]) => {
		if (a === b) return 0;
		const ai = a === null ? -1 : known.indexOf(a);
		const bi = b === null ? -1 : known.indexOf(b);
		if (ai >= 0 || bi >= 0) return ai < 0 ? 1 : bi < 0 ? -1 : ai - bi;
		return a === null ? 1 : b === null ? -1 : compareText(a, b);
	}).map(([value, rows]) => ({ value, items: rows }));
}

export function queryWithFields(query: DbQuery, layout: FieldLayout): DbQuery {
	return { ...query, columns: parseFieldLayout(layout, { shown: query.columns }).shown };
}

export interface DbState {
	readonly version: 1;
	readonly view: DbQuery;
	readonly blocks: Readonly<Record<string, DbQuery>>;
}

export function parseDbState(raw: unknown): DbState {
	const fallback: DbState = { version: 1, view: parseDbQuery({}), blocks: {} };
	if (typeof raw !== 'object' || raw === null || !('version' in raw) || raw.version !== 1) return fallback;
	const r = { ...raw };
	let view = fallback.view;
	try { view = parseDbQuery('view' in r ? r.view : {}); }
	catch (error) { if (!(error instanceof DbConfigError)) throw error; }
	const blocks: Record<string, DbQuery> = {};
	if ('blocks' in r && typeof r.blocks === 'object' && r.blocks !== null && !Array.isArray(r.blocks)) {
		for (const [key, value] of Object.entries(r.blocks)) {
			if (UNSAFE_KEYS.has(key)) continue;
			try { blocks[key] = parseDbQuery(value); }
			catch (error) { if (!(error instanceof DbConfigError)) throw error; }
		}
	}
	return { version: 1, view, blocks };
}

/** Equality defaults are applied before createNote, so a partial second write cannot strand a row. */
export function newNoteContent(query: DbQuery, title: string, date: string, headings: SectionHeadings): string {
	const prefills = new Map<string, DbScalar>();
	for (const filter of query.filter) {
		if (filter.op !== 'equals') continue;
		if (filter.property === 'kit' && filter.value === query.kind) continue;
		if (!canEditProperty(filter.property)) throw new DbConfigError('filter', `Cannot prefill ${filter.property}`);
		if (prefills.has(filter.property) && prefills.get(filter.property) !== filter.value) {
			throw new DbConfigError('filter', `Conflicting equality values for ${filter.property}`);
		}
		if (filter.property === 'status' && !STATUS_BY_KIND[query.kind].some((s) => s === filter.value)) {
			throw new DbConfigError('filter.status', 'New notes need a valid status for their kind');
		}
		prefills.set(filter.property, filter.value);
	}
	const template = renderTemplate(builtinTemplate(query.kind, headings), { title, date, project: '""', parent: '""' });
	const lines = template.split('\n');
	const end = lines.indexOf('---', 1);
	const frontmatter = lines.slice(1, end).filter((line) => !prefills.has(line.split(':')[0] ?? ''));
	for (const [key, value] of prefills) frontmatter.push(`${JSON.stringify(key)}: ${JSON.stringify(value)}`);
	return ['---', ...frontmatter, ...lines.slice(end)].join('\n');
}
