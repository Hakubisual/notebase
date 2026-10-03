import { describe, expect, test } from 'bun:test';
import { moveField, toggleField } from '../../src/core/fields';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import { parseKitItem, type KitItem } from '../../src/core/types';
import { applyQuery, canEditProperty, DbConfigError, groupItems, newNoteContent, parseDbQuery, parseDbState, queryWithFields } from '../../src/features/database/query';

function item(name: string, properties: Readonly<Record<string, unknown>> = {}): KitItem {
	const parsed = parseKitItem({ path: `Kit/${name}.md`, basename: name, mtime: 1,
		frontmatter: { kit: 'task', ...properties } }, () => null);
	if (parsed === null) throw new Error('Invalid test fixture');
	return parsed;
}

describe('database config', () => {
	test('defaults to human fields without internal bookkeeping', () => {
		const query = parseDbQuery({});
		expect(query).toMatchObject({ kind: 'task', layout: 'table', groupBy: 'status' });
		expect(query.columns).toEqual(['status', 'project', 'due', 'owner']);
		expect(parseDbQuery({ layout: 'gallery' }).columns).toHaveLength(3);
	});
	test('parses all options and deduplicates explicitly opted-in internal fields', () => {
		const query = parseDbQuery({ kind: 'record', layout: 'gallery', columns: ['name', 'model', 'owner', 'model'],
			cover: 'image', groupBy: 'owner', filter: [{ property: 'owner', op: 'empty' }], sort: [{ property: 'name', direction: 'desc' }] });
		expect(query.columns).toEqual(['model', 'owner']);
		expect(query.cover).toBe('image');
		expect(query.sort).toEqual([{ property: 'name', direction: 'desc' }]);
	});
	test.each([null, [], 'task', { kind: 'bad' }, { layout: 'calendar' }, { groupBy: '' }, { columns: [2] },
		{ filters: [] }, { filter: {} }, { filter: [{ property: 'owner', op: 'equals' }] },
		{ filter: [{ property: 'owner', op: 'in', value: [{}] }] }, { filter: [{ property: 'owner', op: 'contains', value: 3 }] },
		{ filter: [{ property: 'owner', op: 'empty', value: true }] }, { filter: [{ property: 'owner', op: 'not' }] },
		{ sort: [{ property: 'name', direction: 'up' }] }, { columns: ['__proto__'] }, { cover: 3 }].map((raw) => ({ raw })))('rejects invalid input %#', ({ raw }) => {
		expect(() => parseDbQuery(raw)).toThrow(DbConfigError);
	});
});

describe('database query execution', () => {
	const rows = [item('Basil', { status: 'todo', priority: 10, tags: ['garden'], owner: 'Garden team' }),
		item('Mint', { status: 'doing', priority: 2, owner: '' }), item('Reading', { status: 'mystery' }),
		item('No status'), item('Wiki', { kit: 'wiki', status: 'draft' })];
	test('combines equals and contains without crossing kinds', () => {
		const query = parseDbQuery({ filter: [{ property: 'status', op: 'equals', value: 'todo' }, { property: 'tags', op: 'contains', value: 'garden' }] });
		expect(applyQuery(rows, query).map((i) => i.basename)).toEqual(['Basil']);
	});
	test('matches in values and case-sensitive text contains', () => {
		const query = parseDbQuery({ filter: [{ property: 'status', op: 'in', value: ['doing', 'todo'] }, { property: 'owner', op: 'contains', value: 'team' }] });
		expect(applyQuery(rows, query).map((i) => i.basename)).toEqual(['Basil']);
	});
	test('empty matches missing whitespace null and empty lists but not false or zero', () => {
		const values = [undefined, null, '', '  ', [], false, 0, ['garden']];
		const query = parseDbQuery({ filter: [{ property: 'owner', op: 'empty' }] });
		expect(applyQuery(values.map((owner, i) => item(String(i), { owner })), query).map((i) => i.basename)).toEqual(['0', '1', '2', '3', '4']);
	});
	test('sorts numeric values numerically and missing last in either direction', () => {
		const query = parseDbQuery({ sort: [{ property: 'priority', direction: 'desc' }] });
		expect(applyQuery(rows, query).map((i) => i.basename)).toEqual(['Basil', 'Mint', 'No status', 'Reading']);
		expect(applyQuery(rows, { ...query, sort: [{ property: 'priority', direction: 'asc' }] }).map((i) => i.basename)).toEqual(['Mint', 'Basil', 'No status', 'Reading']);
	});
	test('sort ties are deterministic regardless of index enumeration and input is not mutated', () => {
		const input = [item('Mint', { owner: 'Garden' }), item('Basil', { owner: 'Garden' })];
		const query = parseDbQuery({ sort: [{ property: 'owner' }] });
		expect(applyQuery(input, query).map((i) => i.basename)).toEqual(['Basil', 'Mint']);
		expect(input.map((i) => i.basename)).toEqual(['Mint', 'Basil']);
	});
	test('groups every allowed status and preserves unknown and absent statuses', () => {
		const query = parseDbQuery({ layout: 'board' });
		const groups = groupItems(applyQuery(rows, query), query);
		expect(groups.map((g) => g.value)).toEqual(['todo', 'doing', 'blocked', 'done', 'dropped', 'mystery', null]);
		expect(groups.at(-1)?.items.map((i) => i.basename)).toEqual(['No status']);
	});
	test('custom groups distinguish missing values from a literal Not set', () => {
		const query = parseDbQuery({ groupBy: 'owner' });
		const groups = groupItems([item('Basil', { owner: 'Not set' }), item('Mint')], query);
		expect(groups.map((g) => g.value)).toEqual(['Not set', null]);
	});
});

describe('database persistence and writes', () => {
	test('field toggles and ordering survive parse serialize parse for view and block', () => {
		const base = parseDbQuery({ columns: ['due', 'owner', 'status'] });
		const fields = moveField(toggleField({ shown: base.columns }, 'agent', true), 'agent', -1);
		const view = queryWithFields({ ...base, layout: 'gallery', filter: [{ property: 'status', op: 'equals', value: 'todo' }] }, fields);
		const state = parseDbState({ version: 1, view, blocks: { 'Kit/Reading.md:query': view } });
		const restored = parseDbState(JSON.parse(JSON.stringify(state)));
		expect(restored).toEqual(state);
		expect(restored.view.columns).toEqual(['due', 'owner', 'agent', 'status']);
	});
	test('invalid persisted entries recover individually without retaining unsafe keys', () => {
		const state = parseDbState({ version: 1, view: { kind: 'bad' }, blocks: { good: { kind: 'record' }, bad: { layout: 'chart' } } });
		expect(state.view.kind).toBe('task');
		expect(Object.keys(state.blocks)).toEqual(['good']);
	});
	test('new note prefills equality values once and leaves other predicates unapplied', () => {
		const query = parseDbQuery({ filter: [{ property: 'status', op: 'equals', value: 'doing' },
			{ property: 'owner', op: 'equals', value: 'Garden\nteam' }, { property: 'priority', op: 'equals', value: 2 },
			{ property: 'due', op: 'empty' }] });
		const content = newNoteContent(query, 'Basil', '2026-10-02', DEFAULT_SETTINGS.headings);
		const frontmatter = Bun.YAML.parse(content.split('---')[1] ?? '');
		expect(frontmatter).toMatchObject({ kit: 'task', status: 'doing', owner: 'Garden\nteam', priority: 2, due: '', project: '' });
	});
	test.each([
		{ filter: [{ property: 'kit', op: 'equals', value: 'wiki' }] },
		{ filter: [{ property: 'status', op: 'equals', value: 'verified' }] },
		{ filter: [{ property: 'owner', op: 'equals', value: 'Garden' }, { property: 'owner', op: 'equals', value: 'Reading' }] },
	])('rejects unsafe or contradictory creation defaults %#', ({ filter }) => {
		expect(() => newNoteContent(parseDbQuery({ filter }), 'Basil', '2026-10-02', DEFAULT_SETTINGS.headings)).toThrow(DbConfigError);
	});
	test('keeps identity and structured metadata protected', () => {
		expect(['kit', 'path', 'name', 'position', '__proto__', 'constructor'].some(canEditProperty)).toBe(false);
		expect(canEditProperty('owner')).toBe(true);
	});
});
