import { sanitizeFileName } from '../../core/paths';
import { STATUS_BY_KIND } from '../../core/types';
import type { KitKind } from '../../core/types';
import { CsvError, parseCsv } from './csv';

export const TRANSFER_KINDS = ['project', 'task', 'decision', 'record'] as const;
export type TransferKind = (typeof TRANSFER_KINDS)[number];
export function isTransferKind(value: unknown): value is TransferKind {
	return value === 'project' || value === 'task' || value === 'decision' || value === 'record';
}

export function stripNotionId(name: string): string {
	return name.replace(/\.(md|csv)$/i, '').replace(/\s+[a-f\d]{32}(?:_all)?$/i, '').trim();
}

const ALIASES: Readonly<Record<KitKind, Readonly<Record<string, string>>>> = {
	task: { 'not started': 'todo', 'to do': 'todo', 'in progress': 'doing', complete: 'done', completed: 'done', cancelled: 'dropped', canceled: 'dropped' },
	project: { 'not started': 'active', 'in progress': 'active', 'on hold': 'paused', complete: 'done', completed: 'done', cancelled: 'dropped', canceled: 'dropped' },
	decision: { 'not started': 'open', 'in progress': 'open', done: 'decided', complete: 'decided', completed: 'decided' },
	wiki: { 'not started': 'draft', 'in progress': 'draft', done: 'published' },
	record: { 'not started': 'active', 'in progress': 'active', done: 'archived', complete: 'archived', completed: 'archived' },
};

export function mapStatus(value: string, kind: KitKind): string {
	const lower = value.trim().toLowerCase();
	const aliases = ALIASES[kind];
	return STATUS_BY_KIND[kind].find((s) => s === lower) ?? (Object.prototype.hasOwnProperty.call(aliases, lower) ? aliases[lower] : undefined) ?? value;
}

/** Recognize a whole relation cell, not arbitrary prose containing parentheses. */
export function relationCell(value: string): string[] | null {
	const links: string[] = [];
	const pattern = /(?:^|,\s*)([^,]+?)\s+\(([^)]*\s[a-f\d]{32}\.md)\)/gi;
	let end = 0;
	for (const match of value.matchAll(pattern)) {
		if (match.index !== end) return null;
		links.push(`[[${sanitizeFileName(stripNotionId((match[1] ?? '').trim()))}]]`);
		end = match.index + match[0].length;
	}
	return links.length > 0 && value.slice(end).trim() === '' ? links : null;
}

export function rewriteNotionLinks(markdown: string): string {
	// Leave images, remote links and code blocks/inline code untouched.
	return markdown.split(/(```[^]*?```|~~~[^]*?~~~|`[^`\n]*`)/g).map((part, index) => {
		if (index % 2) return part;
		return part.replace(/(?<!!)\[([^\]]*)\]\(([^)]+)\)/g, (original: string, label: string, raw: string) => {
			let target: string;
			try { target = decodeURIComponent(raw); }
			catch (error) { if (error instanceof URIError) return original; throw error; }
			if (/^[a-z][a-z\d+.-]*:|^\/\//i.test(target)) return original;
			const match = /(?:^|\/)([^/]+\s[a-f\d]{32})\.md(#[^]*)?$/i.exec(target);
			if (!match) return original;
			const title = sanitizeFileName(stripNotionId(match[1] ?? ''));
			const anchor = match[2] ?? '';
			const alias = label !== title && label !== '' ? `|${label.replace(/[[\]|]/g, '')}` : '';
			return `[[${title}${anchor}${alias}]]`;
		});
	}).join('');
}

export interface SourceText { readonly path: string; readonly content: string }
export interface ImportNote {
	readonly title: string;
	readonly source: string;
	readonly properties: Readonly<Record<string, string | readonly string[]>>;
	readonly body: string;
}
export interface ImportPlan {
	readonly notes: readonly ImportNote[];
	readonly skipped: number;
	readonly issues: readonly string[];
}

function notionId(path: string): string | undefined {
	return /\s([a-f\d]{32})(?:_all)?\.(?:csv|md)$/i.exec(path)?.[1]?.toLowerCase();
}

/** A plain project name (this kit's own CSV schema) becomes a link so boards and relations can follow it. */
export function mapCell(key: string, value: string, kind: KitKind): string | readonly string[] {
	if (key === 'status') return mapStatus(value, kind);
	const relation = relationCell(value);
	if (relation !== null) return relation;
	const name = value.trim();
	if (key === 'project' && kind !== 'project' && name !== '' && !name.includes('[[')) return `[[${sanitizeFileName(stripNotionId(name))}]]`;
	return value;
}

export function mapNotionCsv(source: SourceText, kind: TransferKind): ImportPlan {
	const rows = parseCsv(source.content);
	const headers = rows[0];
	if (!headers) return { notes: [], skipped: 1, issues: [`${source.path}: empty CSV`] };
	const keys = headers.map((h) => h.trim().toLowerCase().replace(/\s+/g, '-'));
	const titleIndex = keys.includes('name') ? keys.indexOf('name') : keys.indexOf('title');
	if (titleIndex < 0 || keys.some((k) => k === '') || new Set(keys).size !== keys.length) {
		return { notes: [], skipped: Math.max(rows.length - 1, 1), issues: [`${source.path}: needs unique nonempty columns and Name or Title`] };
	}
	const notes: ImportNote[] = [];
	const issues: string[] = [];
	let skipped = 0;
	for (const [index, row] of rows.slice(1).entries()) {
		const title = stripNotionId(row[titleIndex] ?? '');
		if (row.length !== headers.length || title === '') {
			skipped++; issues.push(`${source.path}: row ${index + 2} has no title or mismatched columns`); continue;
		}
		const properties: Record<string, string | readonly string[]> = { kit: kind };
		for (const [i, key] of keys.entries()) {
			if (i === titleIndex) continue;
			const value = row[i] ?? '';
			// A source Kit column is data, never authority to change the selected kind.
			const property = key === 'kit' ? 'notion-kit' : key;
			Object.defineProperty(properties, property, { value: mapCell(key, value, kind), enumerable: true, configurable: true });
		}
		notes.push({ title, source: source.path, properties, body: '' });
	}
	return { notes, skipped, issues };
}

/** CSV rows and matching database page Markdown become one note, preserving both properties and body. */
export function planNotionImport(sources: readonly SourceText[], kind: TransferKind): ImportPlan {
	const notes: ImportNote[] = [];
	const issues: string[] = [];
	let skipped = 0;
	const databases = new Set<string>();
	const ordered = [...sources].sort((a, b) => Number(/_all\.csv$/i.test(b.path)) - Number(/_all\.csv$/i.test(a.path)) || a.path.localeCompare(b.path));
	for (const source of ordered.filter((s) => /\.csv$/i.test(s.path))) {
		const id = notionId(source.path);
		if (id && databases.has(id)) { skipped++; issues.push(`${source.path}: duplicate database export`); continue; }
		try {
			const mapped = mapNotionCsv(source, kind);
			notes.push(...mapped.notes); skipped += mapped.skipped; issues.push(...mapped.issues);
			if (id && mapped.notes.length > 0) databases.add(id);
		} catch (error) {
			if (!(error instanceof CsvError)) throw error;
			skipped++; issues.push(`${source.path}: ${error.message}`);
		}
	}
	const pages = new Set<string>();
	const merged = new Set<number>();
	for (const source of ordered.filter((s) => /\.md$/i.test(s.path))) {
		const id = notionId(source.path);
		if (id && pages.has(id)) { skipped++; issues.push(`${source.path}: duplicate page export`); continue; }
		if (id) pages.add(id);
		const basename = source.path.split('/').pop() ?? source.path;
		const title = stripNotionId(basename);
		const body = rewriteNotionLinks(source.content);
		const matches = notes.flatMap((note, index) => {
			const databaseFolder = note.source.replace(/_all\.csv$/i, '').replace(/\.csv$/i, '');
			return !merged.has(index) && note.title === title && source.path.startsWith(databaseFolder + '/') ? [index] : [];
		});
		const index = matches.length === 1 ? matches[0] : undefined;
		const existing = index === undefined ? undefined : notes[index];
		if (existing && index !== undefined) { notes[index] = { ...existing, body }; merged.add(index); }
		else notes.push({ title, source: source.path, properties: { kit: 'wiki' }, body });
	}
	for (const source of sources.filter((s) => !/\.(md|csv)$/i.test(s.path))) {
		skipped++; issues.push(`${source.path}: unsupported file (not copied)`);
	}
	return { notes, skipped, issues };
}

export function renderImportNote(note: ImportNote): string {
	const entries = Object.entries(note.properties).map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`);
	// JSON strings/arrays are valid YAML and preserve newlines, punctuation and booleans as text.
	return `---\n${entries.join('\n')}\n---\n\n${note.body}`;
}
