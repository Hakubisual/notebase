import { parseFieldLayout, STANDARD_FIELDS, type FieldLayout } from '../../core/fields';
import { checkRootFolder, cleanPath, isInsideRoot, joinPath } from '../../core/paths';
import { renderTemplate, type TemplateVars } from '../../core/templates';
import { isKitKind } from '../../core/types';
import type { CreateNoteRequest } from '../../core/context';

export interface TemplatePreferences {
	readonly folder: string;
	readonly fields: FieldLayout;
	readonly picker: FieldLayout;
	readonly filter: string;
	readonly sort: 'title' | 'path';
}

export interface YamlCodec {
	parse(source: string): unknown;
	stringify(value: Record<string, unknown>): string;
}

export interface TemplateDocument {
	readonly properties: Readonly<Record<string, unknown>>;
	readonly body: string;
}

function record(value: unknown): Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value) ? { ...value } : {};
}

/** Validate before normalization: cleanPath alone would hide absolute paths. */
export function templateFolder(value: unknown, fallback = 'Notes'): string {
	if (value === undefined || value === null || value === '') return fallback;
	if (typeof value !== 'string') throw new Error('The template folder must be a relative folder name.');
	const folder = value.trim();
	if (folder === '') return fallback;
	if (/^[\\/]|[:*?"<>|]/.test(folder) || [...folder].some((character) => character.charCodeAt(0) < 32)
		|| folder.split(/[\\/]/).some((part) => part.trim() === '..' || part.trim() === '.')) {
		throw new Error('Use a folder relative to the workspace folder, without absolute paths or traversal.');
	}
	const check = checkRootFolder(folder);
	if (!check.ok) throw new Error(check.error);
	return cleanPath(folder);
}

export function checkTemplateDestination(root: string, folder: string): void {
	const check = checkRootFolder(root);
	if (!check.ok) throw new Error(check.error);
	const destination = joinPath(check.root, templateFolder(folder));
	if (!isInsideRoot(check.root, destination)) throw new Error('The template destination must be inside the workspace folder.');
}

export function parseTemplatePreferences(raw: unknown): TemplatePreferences {
	const templates = record(record(raw).templates);
	let folder = 'Templates';
	try {
		folder = templateFolder(templates.folder, 'Templates');
	} catch {
		// Invalid persisted data must never direct a picker or writer outside the kit.
	}
	return {
		folder, fields: parseFieldLayout(templates.fields, { shown: [...STANDARD_FIELDS] }),
		picker: parseFieldLayout(templates.picker, { shown: ['title', 'path'] }),
		filter: typeof templates.filter === 'string' ? templates.filter : '',
		sort: templates.sort === 'title' ? 'title' : 'path',
	};
}

/** Merge with the latest feature blob so the independently owned panel key survives. */
export function saveTemplatePreferences(raw: unknown, preferences: TemplatePreferences): Record<string, unknown> {
	return {
		...record(raw),
		templates: {
			folder: templateFolder(preferences.folder, 'Templates'),
			fields: { shown: [...preferences.fields.shown] },
			picker: { shown: [...preferences.picker.shown] },
			filter: preferences.filter,
			sort: preferences.sort,
		},
	};
}

export function isTemplatePath(root: string, folder: string, path: string): boolean {
	return /\.md$/i.test(path) && isInsideRoot(root, path) && isInsideRoot(joinPath(root, templateFolder(folder, 'Templates')), path);
}

export function templateFields(properties: Readonly<Record<string, unknown>>): string[] {
	return [...new Set([...STANDARD_FIELDS, ...Object.keys(properties)])].filter((field) => field !== 'kit' && field !== 'kit-target');
}

export function selectTemplateFields(properties: Readonly<Record<string, unknown>>, fields: FieldLayout): Record<string, unknown> {
	if (properties.kit !== undefined && !isKitKind(properties.kit)) throw new Error('Template kit must be a known kind, or omitted for a new record.');
	const available = new Set(templateFields(properties));
	const entries: [string, unknown][] = [['kit', isKitKind(properties.kit) ? properties.kit : 'record']];
	for (const field of fields.shown) if (available.has(field)) entries.push([field, properties[field] ?? '']);
	return Object.fromEntries<unknown>(entries);
}

export function splitTemplate(source: string): { yaml: string | null; body: string } {
	const text = source.replace(/^\uFEFF/, '');
	const opening = /^---[ \t]*\r?\n/.exec(text);
	if (opening === null) return { yaml: null, body: text };
	const remaining = text.slice(opening[0].length);
	const closing = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m.exec(remaining);
	if (closing === null) throw new Error('Template frontmatter has no closing delimiter.');
	return { yaml: remaining.slice(0, closing.index), body: remaining.slice(closing.index + closing[0].length) };
}

export function readTemplate(source: string, codec: YamlCodec, vars: TemplateVars = {}): TemplateDocument {
	const { yaml, body } = splitTemplate(source);
	if (yaml === null) return { properties: {}, body: renderTemplate(body, vars) };
	// Substitute safe scalar markers first, even for unquoted {{project}} placeholders.
	// User values enter only after YAML parsing, and are subsequently serialized by the codec.
	let prefix = 'OBTION_TEMPLATE_VALUE_';
	while (yaml.includes(prefix)) prefix += '_';
	const tokens = Object.fromEntries(Object.keys(vars).map((key, index) => [key, `${prefix}${index}_END`]));
	const parsed = codec.parse(renderTemplate(yaml, tokens));
	if (parsed !== null && parsed !== undefined && (typeof parsed !== 'object' || Array.isArray(parsed))) {
		throw new Error('Template frontmatter must be a YAML mapping of fields.');
	}
	function restore(value: unknown): unknown {
		if (value instanceof Date) return value;
		if (typeof value === 'string') {
			// One pass prevents values containing another variable marker from being expanded again.
			const marker = new RegExp(`${prefix}(\\d+)_END`, 'g');
			const values = Object.values(vars);
			return value.replace(marker, (match, index: string) => values[Number(index)] ?? match);
		}
		if (Array.isArray(value)) return value.map((entry: unknown) => restore(entry));
		if (typeof value === 'object' && value !== null) {
			return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, restore(entry)]));
		}
		return value;
	}
	return { properties: record(restore(parsed)), body: renderTemplate(body, vars) };
}

export function createTemplateNote(source: string, title: string, vars: TemplateVars, fields: FieldLayout, codec: YamlCodec): CreateNoteRequest {
	if (title.trim() === '') throw new Error('Enter a title for the new note.');
	const document = readTemplate(source, codec, { ...vars, title });
	const folder = templateFolder(document.properties['kit-target']);
	const properties = selectTemplateFields({ ...document.properties, project: document.properties.project ?? vars.project ?? '' }, fields);
	return { folder, title: title.trim(), content: `---\n${codec.stringify(properties).trimEnd()}\n---\n${document.body}` };
}

export const STARTER_TEMPLATES = [
	{ title: 'Meeting note', body: '## Garden planning meeting\n\n## Agenda\n\n## Decisions\n\n## Next actions\n' },
	{ title: 'Weekly review', body: '## Garden weekly review\n\n## Progress\n\n## Open questions\n\n## Next week\n' },
	{ title: 'Bug report', body: '## Recipe tracker bug\n\n## Expected behavior\n\n## Observed behavior\n\n## Reproduction steps\n\n## Evidence\n' },
	{ title: 'Reading note', body: '## Reading log\n\n## Source\n\n## Notes\n\n## Questions\n' },
].map(({ title, body }) => ({
	title,
	content: `---\nkit: record\nkit-target: Notes\nproject: "{{project}}"\ncreated: "{{date}}"\n---\n${body}`,
}));
