import { describe, expect, test } from 'bun:test';
import { moveField, toggleField } from '../../src/core/fields';
import type { KitItem } from '../../src/core/types';
import { availableFields, fieldValue, parsePreferences } from '../../src/features/navigation/preferences';
import { activeProject, nextOpenTask, parseQuery, recentItems, searchItems } from '../../src/features/navigation/query';

function item(basename: string, overrides: Partial<KitItem> = {}): KitItem {
	return {
		path: `Kit/${basename}.md`, basename, kind: 'task', status: 'todo', projectLink: 'Garden',
		projectPath: 'Kit/Garden.md', properties: {}, mtime: 1, ...overrides,
	};
}

describe('navigation query', () => {
	test('parses filters, quoted phrases and mixed-case free text', () => {
		const input = 'kind:task status:DOING project:"Garden planner" is:open "seed trays" Water';
		const parsed = parseQuery(input);
		expect(parsed).toEqual({ kinds: ['task'], statuses: ['doing'], projects: ['garden planner'], open: true, text: ['seed trays', 'water'] });
	});

	test('keeps unknown and empty tokens as text and tolerates unfinished quotes', () => {
		const input = 'kind: is:closed owner:fern "seed trays';
		const parsed = parseQuery(input);
		expect(parsed.text).toEqual(['kind:', 'is:closed', 'owner:fern', 'seed trays']);
	});

	test('combines kind, status, project, open and text filters', () => {
		const items = [item('Water seedlings', { status: 'doing' }), item('Water seeds'), item('Water beds', { status: 'doing', projectLink: 'Recipes' }), item('Water guide', { kind: 'wiki', status: 'doing' })];
		const result = searchItems(items, 'kind:task status:doing project:garden is:open water');
		expect(result.map((value) => value.basename)).toEqual(['Water seedlings']);
	});

	test('excludes all closed statuses without inventing a missing status', () => {
		const items = ['done', 'dropped', 'archived', 'superseded', 'DONE', 'decided', null].map((status, i) => item(`Seed ${i}`, { status }));
		const result = searchItems(items, 'is:open');
		expect(result.map((value) => value.status)).toEqual(['decided', null]);
	});

	test('orders prefix before word-start before substring before subsequence', () => {
		const items = ['Reseeding', 'Shed entrance east door', 'Sow seed', 'Seed trays'].map((name) => item(name, { projectLink: null }));
		const result = searchItems(items, 'seed');
		expect(result.map((value) => value.basename)).toEqual(['Seed trays', 'Sow seed', 'Reseeding', 'Shed entrance east door']);
	});

	test('matches status and project link as well as basename', () => {
		const items = [item('Water', { status: 'doing', projectLink: 'Garden planner' }), item('Read', { projectLink: null })];
		const result = searchItems(items, 'doing "garden planner"');
		expect(result.map((value) => value.basename)).toEqual(['Water']);
	});

	test('keeps quoted multiword phrases contiguous', () => {
		const items = [item('Seed trays'), item('Seed and trays')];
		const result = searchItems(items, '"seed trays"');
		expect(result.map((value) => value.basename)).toEqual(['Seed trays']);
	});

	test('uses basename then path for stable ties independent of input order', () => {
		const items = [item('Water'), item('Plant', { path: 'Kit/B/Plant.md' }), item('Plant', { path: 'Kit/A/Plant.md' })];
		const result = searchItems(items, '');
		expect(result.map((value) => value.path)).toEqual(['Kit/A/Plant.md', 'Kit/B/Plant.md', 'Kit/Water.md']);
		expect(searchItems([...items].reverse(), '')).toEqual(result);
	});

	test('returns nothing for contradictory filters, unmatched text or an empty index', () => {
		const items = [item('Water')];
		const results = ['kind:task kind:wiki', 'status:doing', 'project:recipes', 'unmatchable'].map((query) => searchItems(items, query));
		expect(results).toEqual([[], [], [], []]);
		expect(searchItems([], '')).toEqual([]);
	});

	test('sorts title independently of fuzzy relevance when requested', () => {
		const items = [item('Seed'), item('A seed')];
		const result = searchItems(items, 'seed', 'title');
		expect(result.map((value) => value.basename)).toEqual(['A seed', 'Seed']);
	});
});

describe('project navigation', () => {
	const project = item('Garden', { kind: 'project', projectPath: null, projectLink: null });
	const tasks = [item('Water'), item('Plant'), item('Done', { status: 'done' }), item('Other', { projectPath: 'Kit/Recipes.md' })];

	test('resolves an active project or a linked task using paths', () => {
		const items = [project, ...tasks];
		const result = [activeProject(items, project.path), activeProject(items, 'Kit/Plant.md')];
		expect(result).toEqual([project, project]);
	});

	test('rejects missing, unresolved, unindexed and non-project targets', () => {
		const items = [item('Seed', { projectPath: null }), item('Water', { projectPath: 'Kit/Seed.md' })];
		const results = [null, 'Outside.md', 'Kit/Seed.md', 'Kit/Water.md'].map((path) => activeProject(items, path));
		expect(results).toEqual([null, null, null, null]);
	});

	test('cycles by basename and wraps while excluding closed and other-project tasks', () => {
		const items = [project, ...tasks];
		const results = [project.path, 'Kit/Plant.md', 'Kit/Water.md', 'Kit/Done.md'].map((path) => nextOpenTask(items, project.path, path)?.basename);
		expect(results).toEqual(['Plant', 'Water', 'Plant', 'Plant']);
	});

	test('handles empty and single-task projects', () => {
		const results = [nextOpenTask([], project.path, null), nextOpenTask([item('Plant')], project.path, 'Kit/Plant.md')?.basename];
		expect(results).toEqual([null, 'Plant']);
	});

	test('recent ordering uses descending mtime then stable basename and path', () => {
		const items = [item('Water', { mtime: 7 }), item('Read', { mtime: 9 }), item('Plant', { mtime: 7 })];
		const result = recentItems(items);
		expect(result.map((value) => value.basename)).toEqual(['Read', 'Plant', 'Water']);
		expect(items.map((value) => value.basename)).toEqual(['Water', 'Read', 'Plant']);
	});
});

describe('navigation customization', () => {
	test('round-trips explicit internal fields, ordering, filter and separate recent sort', () => {
		const initial = parsePreferences({ fields: { shown: ['owner', 'due', 'agent'] }, filter: 'is:open', sort: 'title', recentSort: 'relevance' });
		const edited = { ...initial, fields: moveField(toggleField(initial.fields, 'owner', false), 'agent', -1) };
		const result = parsePreferences(JSON.parse(JSON.stringify(edited)));
		expect(result).toEqual({ fields: { shown: ['agent', 'due'] }, filter: 'is:open', sort: 'title', recentSort: 'relevance' });
	});

	test('defaults to human fields and offers internal fields only for explicit selection', () => {
		const preferences = parsePreferences(null);
		const fields = availableFields([item('Seed', { properties: { agent: 'seed helper', tokens: 4 } })], preferences.fields);
		expect(preferences.fields.shown).toEqual(['status', 'project', 'due', 'owner']);
		expect(fields).toContain('verified');
		expect(preferences.fields.shown).not.toContain('agent');
		expect(preferences.fields.shown).not.toContain('tokens');
		expect(fields).toContain('agent');
		expect(fields).toContain('tokens');
	});

	test('sanitizes malformed preferences and preserves an intentionally empty layout', () => {
		const malformed = parsePreferences({ fields: { shown: [3, 'owner', 'owner', ''] }, filter: 3, sort: 'broken' });
		const empty = parsePreferences(JSON.parse(JSON.stringify({ fields: { shown: [] } })));
		expect(malformed).toEqual({ fields: { shown: ['owner'] }, filter: '', sort: 'relevance', recentSort: 'recent' });
		expect(empty.fields.shown).toEqual([]);
		expect(parsePreferences([])).toEqual(parsePreferences(null));
	});

	test('never fabricates owner, due, verification or status and preserves false values', () => {
		const note = item('Seed', { status: null, projectLink: null, properties: { verified: false } });
		const result = ['owner', 'due', 'status', 'project', 'verified'].map((field) => fieldValue(note, field));
		expect(result).toEqual([null, null, null, null, 'false']);
	});

	test('saved filters remain independent from unfinished search quotes', () => {
		const items = [item('Seed trays'), item('Seed trays done', { status: 'done' })];
		const result = searchItems(searchItems(items, 'is:open'), '"seed trays');
		expect(result.map((value) => value.basename)).toEqual(['Seed trays']);
	});
});
