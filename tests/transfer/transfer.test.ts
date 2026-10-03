import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';
import { moveField, toggleField } from '../../src/core/fields';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import { parseKitItem } from '../../src/core/types';
import { CsvError, parseCsv, serializeCsv } from '../../src/features/transfer/csv';
import { exportCsv, exportMarkdown, exportRow, parseTransferPreferences, selectRows } from '../../src/features/transfer/export';
import { mapCell, mapNotionCsv, mapStatus, planNotionImport, relationCell, renderImportNote, rewriteNotionLinks, stripNotionId } from '../../src/features/transfer/notion';
import { transferRequest, TransferDestinationError } from '../../src/features/transfer/write';

const id = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const database = 'Tasks aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

describe('CSV', () => {
	test('parses BOM, CRLF, commas, escaped quotes and embedded newlines', () => {
		const csv = '\uFEFFName,Notes\r\nGarden,"A, B and ""C""\r\nD"\r\n';
		const rows = parseCsv(csv);
		expect(rows).toEqual([['Name', 'Notes'], ['Garden', 'A, B and "C"\r\nD']]);
	});
	test('round-trips Korean and empty fields without phantom final records', () => {
		const rows = [['Name', 'Notes'], ['정원', 'a\nb'], ['', ''], ['"quoted"', 'end,']];
		const csv = serializeCsv(rows);
		expect(csv.charCodeAt(0)).toBe(0xFEFF);
		expect(parseCsv(csv)).toEqual(rows);
	});
	test('distinguishes empty input, blank records and trailing empty fields', () => {
		expect(parseCsv('')).toEqual([]);
		expect(parseCsv('\uFEFF')).toEqual([]);
		expect(parseCsv('\r\n')).toEqual([['']]);
		expect(parseCsv('a,b,')).toEqual([['a', 'b', '']]);
		expect(parseCsv('""')).toEqual([['']]);
	});
	test.each(['"unclosed', 'plain"quote', '"closed"junk'])('rejects malformed quotes: %s', (csv) => {
		expect(() => parseCsv(csv)).toThrow(CsvError);
	});
});

describe('Notion mapping', () => {
	test('strips only a trailing Notion id and recognizes all-database exports', () => {
		expect(stripNotionId(`Garden ${id}.md`)).toBe('Garden');
		expect(stripNotionId(`Garden ${id}_all.csv`)).toBe('Garden');
		expect(stripNotionId('Garden 1234.md')).toBe('Garden 1234');
	});
	test('maps known statuses per kind without inventing missing or unknown values', () => {
		expect(mapStatus('In Progress', 'task')).toBe('doing');
		expect(mapStatus('Not started', 'task')).toBe('todo');
		expect(mapStatus('DONE', 'project')).toBe('done');
		expect(mapStatus('Done', 'decision')).toBe('decided');
		expect(mapStatus('Done', 'record')).toBe('archived');
		expect(mapStatus('', 'task')).toBe('');
		expect(mapStatus('Awaiting rain', 'task')).toBe('Awaiting rain');
		expect(mapStatus('constructor', 'task')).toBe('constructor');
	});
	test('maps whole relation cells and leaves prose untouched', () => {
		expect(relationCell(`Garden (path/Garden ${id}.md), Recipes (Recipes ${id}.md)`)).toEqual(['[[Garden]]', '[[Recipes]]']);
		expect(relationCell('Herbs (fresh), salt')).toBeNull();
		expect(relationCell(`Garden (Garden ${id}.md) more text`)).toBeNull();
	});
	test('rewrites local page links but preserves remote, image, code and malformed targets', () => {
		const md = `[Garden](Garden%20${id}.md) [see](Garden%20${id}.md#Soil) ![Garden](Garden%20${id}.md) [remote](https://example.invalid/Garden%20${id}.md) \`[Garden](Garden%20${id}.md)\` [bad](%ZZ.md)`;
		const output = rewriteNotionLinks(md);
		expect(output).toContain('[[Garden]] [[Garden#Soil|see]]');
		expect(output).toContain(`![Garden](Garden%20${id}.md)`);
		expect(output).toContain(`https://example.invalid/Garden%20${id}.md`);
		expect(output).toContain(`\`[Garden](Garden%20${id}.md)\``);
		expect(output).toContain('[bad](%ZZ.md)');
	});
	test('loads synthetic export and merges row properties with database page body', async () => {
		const paths = [`${database}.csv`, `${database}/Water seedlings dddddddddddddddddddddddddddddddd.md`, `Garden ${id}.md`];
		const sources = await Promise.all(paths.map(async (path) => ({ path, content: await Bun.file(new URL(`fixtures/${path}`, import.meta.url)).text() })));
		const plan = planNotionImport(sources, 'task');
		expect(plan.skipped).toBe(0);
		expect(plan.notes).toHaveLength(3);
		const water = plan.notes.find((note) => note.title === 'Water seedlings');
		expect(water?.properties).toMatchObject({ kit: 'task', status: 'doing', project: ['[[Garden]]'], owner: '', due: '2026-10-10' });
		expect(water?.body).toContain('[[Garden]]');
		expect(water?.body).toContain('- [ ] Check soil before watering.');
		expect(plan.notes.find((note) => note.title === 'Garden')?.properties).toEqual({ kit: 'wiki' });
	});
	test('counts malformed files, unnamed rows and unsupported attachments as skipped', () => {
		const sources = [{ path: 'a.csv', content: 'Name,Status\n,Done\nGood,todo\nBad,todo,extra' }, { path: 'b.csv', content: '"broken' }, { path: 'c.png', content: '' }];
		const plan = planNotionImport(sources, 'task');
		expect(plan.notes.map((n) => n.title)).toEqual(['Good']);
		expect(plan.skipped).toBe(4);
		expect(plan.issues).toHaveLength(4);
	});
	test('rejects ambiguous headers instead of silently losing properties', () => {
		const plan = mapNotionCsv({ path: 'rows.csv', content: 'Name,Due,Due\nHerbs,soon,later' }, 'record');
		expect(plan.notes).toEqual([]);
		expect(plan.skipped).toBe(1);
	});
	test('prefers the all database CSV and skips repeated page ids', () => {
		const content = 'Name,Status\nHerbs,Done';
		const plan = planNotionImport([{ path: `${database}.csv`, content }, { path: `${database}_all.csv`, content }, { path: `Garden ${id}.md`, content: '# Garden' }, { path: `copy/Garden ${id}.md`, content: '# Garden' }], 'record');
		expect(plan.notes).toHaveLength(2);
		expect(plan.skipped).toBe(2);
	});
	test('quotes YAML text safely and cannot replace the selected kit kind', () => {
		const plan = mapNotionCsv({ path: 'rows.csv', content: 'Title,Kit,Owner,Notes,__proto__\nHerbs,task,,"first\nstatus: done",safe' }, 'record');
		const note = plan.notes[0];
		expect(note).toBeDefined();
		if (!note) return;
		const rendered = renderImportNote(note);
		const properties = Object.fromEntries(rendered.split('\n').filter((line) => line.startsWith('"')).map((line) => {
			const split = line.indexOf(': ');
			const key: unknown = JSON.parse(line.slice(0, split));
			const value: unknown = JSON.parse(line.slice(split + 2));
			return [String(key), value];
		}));
		expect(properties).toMatchObject({ kit: 'record', 'notion-kit': 'task', owner: '', notes: 'first\nstatus: done' });
		expect(Object.prototype.hasOwnProperty.call(properties, '__proto__')).toBe(true);
	});
});

describe('export and customization', () => {
	function item(kind: string, properties: Record<string, unknown> = {}) {
		const value = parseKitItem({ path: 'Kit/Garden.md', basename: 'Garden', mtime: 1, frontmatter: { kit: kind, ...properties } }, () => null);
		if (!value) throw new TypeError('Invalid fixture kind');
		return value;
	}
	test('exports project schema using real section summaries and empty status', () => {
		const markdown = '## Principle\n- Grow herbs\n## To do\n- [x] Buy pots\n- [ ] Water\n## Done\n- Sow\n## Verification limits\n- No harvest yet';
		const row = exportRow(item('project'), markdown, DEFAULT_SETTINGS.headings);
		const table = parseCsv(exportCsv('project', [row]));
		expect(table).toEqual([['Name', 'Status', 'Principle', 'Next action', 'Done summary', 'Verification limits'], ['Garden', '', 'Grow herbs', 'Water', 'Sow', 'No harvest yet']]);
	});
	test('exports task relations by title, and never invents due or owner', () => {
		const row = exportRow(item('task', { status: 'doing', project: ['[[Herbs]]', '[[Recipes|Cookbook]]'], priority: 'High' }), '', DEFAULT_SETTINGS.headings);
		expect(parseCsv(exportCsv('task', [row]))).toEqual([['Name', 'Status', 'Project', 'Due', 'Priority'], ['Garden', 'doing', 'Herbs, Recipes', '', 'High']]);
		expect(row.values.owner).toBeUndefined();
	});
	test('exports decision and record columns without task-only fields', () => {
		const row = exportRow(item('decision', { status: 'decided', decided: '2026-10-02', project: '[[Herbs]]' }), '', DEFAULT_SETTINGS.headings);
		expect(parseCsv(exportCsv('decision', [row]))).toEqual([['Name', 'Status', 'Project', 'Decided'], ['Garden', 'decided', 'Herbs', '2026-10-02']]);
		expect(parseCsv(exportCsv('record', []))).toEqual([['Name', 'Status', 'Project']]);
	});
	test('round-trips persisted layout, explicit internal opt-in, filters and order', () => {
		const defaults = parseTransferPreferences(null);
		const changed = { ...defaults, query: 'herb', status: 'doing', sort: 'due', descending: true, layout: moveField(toggleField({ shown: ['name', 'due'] }, 'model', true), 'model', -1) };
		const parsed = parseTransferPreferences(JSON.parse(JSON.stringify(changed)));
		expect(parsed).toEqual(changed);
		expect(parsed.layout.shown).toEqual(['name', 'model', 'due']);
		expect(defaults.layout.shown).not.toContain('model');
		expect(parseTransferPreferences({ layout: { shown: [] } }).layout.shown).toEqual([]);
	});
	test('filters exact status and names then sorts selected properties', () => {
		const rows = [{ path: 'a', values: { name: 'Herb A', status: 'doing', due: '2026-10-10' } }, { path: 'b', values: { name: 'Herb B', status: 'doing', due: '2026-10-01' } }, { path: 'c', values: { name: 'Herb C', status: 'done', due: '2026-10-02' } }];
		const selected = selectRows(rows, { ...parseTransferPreferences(null), query: 'HERB', status: 'doing', sort: 'due' });
		expect(selected.map((row) => row.path)).toEqual(['b', 'a']);
	});
	test('Markdown respects chosen order and escapes table-breaking values', () => {
		const output = exportMarkdown([{ path: 'a', values: { name: 'Herbs | basil', owner: '<none>\nNot set', model: 'hidden' } }], { shown: ['owner', 'name'] });
		expect(output).toContain('| Owner | Name |');
		expect(output).toContain('| &lt;none&gt;<br>Not set | Herbs &#124; basil |');
		expect(output).not.toContain('hidden');
	});
	test('unknown persisted fields never read inherited object properties', () => {
		const rows = [{ path: 'b', values: { name: 'B' } }, { path: 'a', values: { name: 'A' } }];
		const preferences = parseTransferPreferences({ sort: 'constructor', layout: { shown: ['constructor'] } });
		const selected = selectRows(rows, preferences);
		expect(selected.map((row) => row.path)).toEqual(['a', 'b']);
		expect(exportMarkdown(selected, preferences.layout)).toBe('| Constructor |\n| --- |\n|  |\n|  |\n');
	});
});

describe('transfer write destinations', () => {
	test.each(['', '/', '.', '../Kit', '.obsidian', 'Kit/../Other'])('rejects invalid roots before import or export: %s', (root) => {
		for (const folder of ['Imports/Garden 2026-10-02', 'Exports']) {
			expect(() => transferRequest(root, { folder, title: 'Garden', content: '' })).toThrow(TransferDestinationError);
		}
	});
	test('rejects escaping destinations and accepts only root-relative import/export folders', () => {
		expect(() => transferRequest('Kit', { folder: '../Outside', title: 'Garden', content: '' })).toThrow(TransferDestinationError);
		for (const folder of ['Imports/Garden 2026-10-02', 'Exports']) {
			expect(transferRequest('Kit', { folder, title: 'Garden', content: '' }).folder).toBe(folder);
		}
	});
	test('source kit false remains data and cannot opt a created note out', () => {
		const result = mapNotionCsv({ path: 'Garden.csv', content: 'Name,Kit\nHerbs,false' }, 'record');
		expect(result.notes[0]?.properties).toEqual({ kit: 'record', 'notion-kit': 'false' });
	});
});

describe('project links from plain names', () => {
	test('a plain Project cell becomes a wikilink for tasks and decisions, not for projects', () => {
		expect(mapCell('project', 'Recipe box', 'task')).toBe('[[Recipe box]]');
		expect(mapCell('project', '  ', 'decision')).toBe('  ');
		expect(mapCell('project', '[[Already linked]]', 'task')).toBe('[[Already linked]]');
		expect(mapCell('project', 'Recipe box', 'project')).toBe('Recipe box');
		expect(mapCell('owner', 'Alex', 'task')).toBe('Alex');
	});

	test('the shipped Notion import pack round-trips into linked kit tasks', () => {
		const content = readFileSync('templates/notion/Tasks.csv', 'utf8');
		const plan = mapNotionCsv({ path: 'Notion export/Tasks 00000000000000000000000000000000.csv', content }, 'task');
		expect(plan.notes.map((n) => n.title)).toEqual(['Order compost', 'Sketch drip line', 'Add weeknight dinners', 'Measure sunlight per bed']);
		expect(plan.notes.map((n) => n.properties.project)).toEqual(['[[Garden planner]]', '[[Garden planner]]', '[[Recipe box]]', '[[Garden planner]]']);
		expect(plan.notes.map((n) => n.properties.status)).toEqual(['todo', 'doing', 'todo', 'done']);
	});
});
