import { describe, expect, test } from 'bun:test';
import type { KitItem } from '../../src/core/types';
import { extractLinks, incomingRelations, incomingRollup, outgoingRelations, parseRollupConfig, resolveInItems, rollup } from '../../src/features/relations/model';
import { arrangeEntries, fieldNames, panelData, parsePanelPreferences, withPanelData } from '../../src/features/relations/preferences';
import { moveField, toggleField } from '../../src/core/fields';

function item(path: string, properties: Readonly<Record<string, unknown>> = {}, status: string | null = null): KitItem {
	return { path, basename: path.split('/').pop()?.replace(/\.md$/, '') ?? '', kind: 'task', properties, status, projectPath: null, projectLink: null, mtime: 1 };
}

describe('relations', () => {
	test('extracts wikilink strings and lists with aliases and headings, not plain text', () => {
		expect(extractLinks(['[[Garden#Plan|Plan]]', '[[Garden|Again]]', '[[Seeds]]', 'Garden', 3, null, ['[[No]]'], '[[ ]]', 'prefix [[No]]', '[[One]][[Two]]'])).toEqual([{ target: 'Garden', label: 'Plan' }, { target: 'Seeds', label: 'Seeds' }]);
		expect(extractLinks(' [[Garden^block]] ')).toEqual([{ target: 'Garden', label: 'Garden' }]);
	});
	test('groups outgoing links by property and retains unresolved targets', () => {
		const garden = item('Kit/Garden.md');
		const task = item('Kit/Water.md', { project: ['[[Garden]]', '[[Kit/Garden.md|Path]]'], related: '[[Missing]]', title: 'Garden' });
		const items = [garden, task];
		const groups = outgoingRelations(task, items, (target, source) => resolveInItems(items, target, source));
		expect(groups.map((group) => [group.property, group.entries.length])).toEqual([['project', 1], ['related', 1]]);
		expect(groups[0]?.entries[0]?.item?.path).toBe(garden.path);
		expect(groups[1]?.entries[0]?.item).toBeNull();
	});
	test('incoming groups deduplicate repeated links and exclude the note itself', () => {
		const garden = item('Kit/Garden.md', { related: '[[Garden]]' });
		const water = item('Kit/Water.md', { project: ['[[Garden]]', '[[Garden|Alias]]'], related: '[[Garden#Plan]]' });
		const seed = item('Kit/Seed.md', { project: 'Garden' });
		const items = [garden, water, seed];
		const groups = incomingRelations(garden.path, items, (target, source) => resolveInItems(items, target, source));
		expect(groups.map((group) => [group.property, group.entries.map((entry) => entry.item?.path)])).toEqual([['project', [water.path]], ['related', [water.path]]]);
	});
	test('ambiguous basenames remain unresolved and exact paths select the right note', () => {
		const items = [item('Kit/A/Garden.md'), item('Kit/B/Garden.md')];
		expect(resolveInItems(items, 'Garden', 'Kit/Task.md')).toBeNull();
		expect(resolveInItems(items, 'Garden', 'Kit/A/Task.md')).toBe('Kit/A/Garden.md');
		expect(resolveInItems(items, 'Kit/B/Garden.md', 'Kit/Task.md')).toBe('Kit/B/Garden.md');
	});
	test('rollup counts unknown and absent status without inventing completion', () => {
		const done = item('Kit/A.md', {}, 'done');
		const summary = rollup([done, done, item('Kit/B.md', {}, 'doing'), item('Kit/C.md'), item('Kit/D.md', {}, 'custom')]);
		expect(summary).toEqual({ total: 4, counts: [{ status: 'done', count: 1 }, { status: 'doing', count: 1 }, { status: null, count: 1 }, { status: 'custom', count: 1 }], percentDone: 25 });
		expect(rollup([])).toEqual({ total: 0, counts: [], percentDone: null });
	});
	test('parses rollup property and kind and rejects malformed configuration', () => {
		expect(parseRollupConfig('property: project\nkind: task')).toEqual({ property: 'project', kind: 'task' });
		expect(parseRollupConfig('')).toEqual({ property: 'project', kind: null });
		for (const source of ['kind: bad', 'property:', 'unknown: task', 'property: a\nproperty: b']) expect(typeof parseRollupConfig(source)).toBe('string');
	});
	test('incoming rollup applies property and kind before calculating completion', () => {
		const garden = item('Kit/Garden.md');
		const items: KitItem[] = [garden, item('Kit/Water.md', { project: '[[Garden]]' }, 'done'), item('Kit/Seed.md', { related: '[[Garden]]' }, 'doing'), { ...item('Kit/Review.md', { project: '[[Garden]]' }, 'active'), kind: 'record' }];
		const resolve = (target: string, source: string): string | null => resolveInItems(items, target, source);
		expect(incomingRollup(garden.path, items, resolve, { property: 'project', kind: 'task' })).toEqual({ total: 1, counts: [{ status: 'done', count: 1 }], percentDone: 100 });
		expect(incomingRollup(garden.path, items, resolve, { property: 'project', kind: null }).percentDone).toBe(50);
		expect(incomingRollup(garden.path, items, resolve, { property: 'missing', kind: null }).percentDone).toBeNull();
	});
});

describe('persisted relation controls', () => {
	test('defaults hide internal fields and lead with human fields', () => {
		const fields = fieldNames([item('Kit/A.md', { token: 20, session: 'x', owner: '', harvest: 'summer' })]);
		const prefs = parsePanelPreferences(null, fields);
		expect(prefs.layout.shown).toEqual(['status', 'due', 'owner']);
		expect(prefs.layout.shown).not.toContain('session');
		expect(prefs.layout.shown).not.toContain('token');
		expect(fields).toContain('harvest');
	});
	test('visibility order filter and sort round-trip without losing template settings', () => {
		const base = parsePanelPreferences(null, ['next', 'owner', 'session']);
		const layout = moveField(toggleField(base.layout, 'session', true), 'session', -1);
		const prefs = { ...base, layout, filter: 'garden', kind: 'task', sort: 'due' } as const;
		const saved = withPanelData({ templates: { folder: 'Templates' } }, prefs);
		const restored: unknown = JSON.parse(JSON.stringify(saved));
		expect(parsePanelPreferences(panelData(restored), [])).toEqual(prefs);
		expect(saved.templates).toEqual({ folder: 'Templates' });
		expect(parsePanelPreferences({ layout: { shown: [] } }, ['owner']).layout.shown).toEqual([]);
	});
	test('filters visible fields and sorts missing due values last', () => {
		const entries = [item('Kit/Water.md', { due: '2026-01-03', owner: 'Garden club' }), item('Kit/Seeds.md', { owner: 'Garden club' }), item('Kit/Soil.md', { due: '2026-01-01', owner: 'Garden club' })].map((note) => ({ target: note.path, label: note.basename, item: note }));
		const prefs = parsePanelPreferences({ layout: { shown: ['owner'] }, filter: 'garden', kind: 'task', sort: 'due' }, []);
		expect(arrangeEntries(entries, prefs).map((entry) => entry.label)).toEqual(['Soil', 'Water', 'Seeds']);
		expect(arrangeEntries(entries, { ...prefs, layout: { shown: [] } })).toEqual([]);
	});
});
