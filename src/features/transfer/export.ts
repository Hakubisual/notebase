import { displayValue, FIELD_LABELS, parseFieldLayout, STANDARD_FIELDS, visibleByDefault } from '../../core/fields';
import type { FieldLayout } from '../../core/fields';
import { parseProjectSections, summarizeProject } from '../../core/sections';
import type { SectionHeadings } from '../../core/sections';
import type { KitItem } from '../../core/types';
import { serializeCsv } from './csv';
import { isTransferKind } from './notion';
import type { TransferKind } from './notion';

export interface TransferPreferences {
	readonly kind: TransferKind;
	readonly importKind: TransferKind;
	readonly status: string;
	readonly query: string;
	readonly descending: boolean;
	readonly sort: string;
	readonly layout: FieldLayout;
}

export function parseTransferPreferences(raw: unknown): TransferPreferences {
	const data: Record<string, unknown> = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? { ...raw } : {};
	return {
		kind: isTransferKind(data.kind) ? data.kind : 'project',
		importKind: isTransferKind(data.importKind) ? data.importKind : 'record',
		status: typeof data.status === 'string' ? data.status : '',
		query: typeof data.query === 'string' ? data.query : '',
		descending: data.descending === true,
		sort: typeof data.sort === 'string' ? data.sort : 'name',
		layout: parseFieldLayout(data.layout, { shown: ['name', ...visibleByDefault(STANDARD_FIELDS)] }),
	};
}

export interface ExportRow { readonly path: string; readonly values: Readonly<Record<string, string>> }
export function fieldValue(row: ExportRow, field: string): string {
	return Object.prototype.hasOwnProperty.call(row.values, field) ? row.values[field] ?? '' : '';
}

export function exportRow(item: KitItem, markdown: string, headings: SectionHeadings): ExportRow {
	const values: Record<string, string> = {};
	for (const [key, value] of Object.entries(item.properties)) {
		Object.defineProperty(values, key, { value: displayValue(value) ?? '', enumerable: true, writable: true, configurable: true });
	}
	values.name = item.basename;
	values.status = item.status ?? '';
	values.project = relationNames(item.properties.project) || item.projectLink || '';
	if (item.kind === 'project') {
		const summary = summarizeProject(parseProjectSections(markdown, headings));
		values.principle = summary.principle ?? '';
		values.next = summary.nextTodo ?? '';
		values['done-summary'] = summary.latestDone ?? '';
		values['verification-limits'] = summary.limit ?? '';
	}
	return { path: item.path, values };
}

function relationNames(value: unknown): string {
	if (Array.isArray(value)) return value.map(relationNames).filter(Boolean).join(', ');
	if (typeof value !== 'string') return '';
	return value.replace(/\[\[([^\]|#]+)(?:[^\]]*)\]\]/g, '$1');
}

export function selectRows(rows: readonly ExportRow[], preferences: TransferPreferences): ExportRow[] {
	const query = preferences.query.toLowerCase();
	return rows.filter((row) => (!preferences.status || row.values.status === preferences.status) && (row.values.name ?? '').toLowerCase().includes(query))
		.sort((a, b) => (fieldValue(a, preferences.sort).localeCompare(fieldValue(b, preferences.sort)) || a.path.localeCompare(b.path)) * (preferences.descending ? -1 : 1));
}

const COLUMNS = {
	project: [['name', 'Name'], ['status', 'Status'], ['principle', 'Principle'], ['next', 'Next action'], ['done-summary', 'Done summary'], ['verification-limits', 'Verification limits']],
	task: [['name', 'Name'], ['status', 'Status'], ['project', 'Project'], ['due', 'Due'], ['priority', 'Priority']],
	decision: [['name', 'Name'], ['status', 'Status'], ['project', 'Project'], ['decided', 'Decided']],
	record: [['name', 'Name'], ['status', 'Status'], ['project', 'Project']],
} as const;

export function exportCsv(kind: TransferKind, rows: readonly ExportRow[]): string {
	const columns = COLUMNS[kind];
	return serializeCsv([columns.map(([, label]) => label), ...rows.map((row) => columns.map(([key]) => fieldValue(row, key)))]);
}

export function fieldLabel(field: string): string {
	if (field === 'name') return 'Name';
	const known = STANDARD_FIELDS.find((key) => key === field);
	return known ? FIELD_LABELS[known] : field.replace(/[-_]/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

export function exportMarkdown(rows: readonly ExportRow[], layout: FieldLayout): string {
	const fields = layout.shown;
	if (fields.length === 0) return 'No fields selected.\n';
	const escape = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\\/g, '\\\\').replace(/\|/g, '&#124;').replace(/\r\n|\r|\n/g, '<br>');
	const line = (cells: readonly string[]): string => `| ${cells.join(' | ')} |`;
	return [line(fields.map((f) => escape(fieldLabel(f)))), line(fields.map(() => '---')), ...rows.map((row) => line(fields.map((f) => escape(fieldValue(row, f))))), ''].join('\n');
}
