import { describe, expect, test } from 'bun:test';
import { moveField, toggleField } from '../../src/core/fields';
import type { KitItem } from '../../src/core/types';
import { breadcrumb, buildWikiTree, descendants, parseDepth } from '../../src/features/wiki/hierarchy';
import { fieldValue, parsePreferences, parseWikiData, sortedNodes, visiblePaths } from '../../src/features/wiki/preferences';
import { prepareWikiPage } from '../../src/features/wiki/creation';
import { DEFAULT_SETTINGS } from '../../src/core/settings';

function page(name: string, parent?: unknown, folder = 'Kit/Wiki', properties: Readonly<Record<string, unknown>> = {}): KitItem {
	return { path: `${folder}/${name}.md`, basename: name, kind: 'wiki', status: null,
		projectLink: null, projectPath: null, properties: { ...properties, parent }, mtime: 1 };
}

describe('wiki hierarchy', () => {
	test('builds title-sorted roots and children from path, basename, alias and list links', () => {
		const pages = [page('Recipes'), page('Tea', '[[Kit/Wiki/Recipes.md|Recipe book]]'), page('Bread', ['[[Recipes#Baking]]']), page('Garden')];
		const tree = buildWikiTree(pages);
		expect(tree.roots.map((node) => node.item.basename)).toEqual(['Garden', 'Recipes']);
		expect(tree.nodes.get('Kit/Wiki/Recipes.md')?.children.map((node) => node.item.basename)).toEqual(['Bread', 'Tea']);
		expect(tree.issues).toEqual([]);
	});

	test('resolves local and suffix paths without confusing duplicate basenames', () => {
		const pages = [page('Index', undefined, 'Kit/Recipes'), page('Index', undefined, 'Kit/Garden'),
			page('Tea', '[[Index]]', 'Kit/Recipes'), page('Soil', '[[Garden/Index]]')];
		const tree = buildWikiTree(pages);
		expect(tree.nodes.get('Kit/Recipes/Tea.md')?.parent?.item.path).toBe('Kit/Recipes/Index.md');
		expect(tree.nodes.get('Kit/Wiki/Soil.md')?.parent?.item.path).toBe('Kit/Garden/Index.md');
	});

	test('reports orphan, ambiguous and malformed parents without losing pages', () => {
		const pages = [page('Index', undefined, 'Kit/Recipes'), page('Index', undefined, 'Kit/Garden'),
			page('Tea', '[[Index]]'), page('Missing', '[[Gone]]'), page('Invalid', ['[[Tea]]', '[[Missing]]'])];
		const tree = buildWikiTree(pages);
		expect(tree.roots).toHaveLength(5);
		expect(tree.issues).toEqual([
			{ path: 'Kit/Wiki/Invalid.md', kind: 'invalid' },
			{ path: 'Kit/Wiki/Missing.md', kind: 'orphan' },
			{ path: 'Kit/Wiki/Tea.md', kind: 'ambiguous' },
		]);
	});

	test('uses the host resolver authoritatively and rejects non-wiki targets', () => {
		const recipe = page('Recipes');
		const pages = [recipe, page('Tea', '[[Alias]]'), { ...page('Task'), kind: 'task' as const }, page('Soil', '[[Task]]'), page('Lost', '[[Recipes]]')];
		const tree = buildWikiTree(pages, (link) => link === 'Alias' ? recipe.path : link === 'Task' ? 'Kit/Wiki/Task.md' : null);
		expect(tree.nodes.get('Kit/Wiki/Tea.md')?.parent?.item.path).toBe(recipe.path);
		expect(tree.nodes.has('Kit/Wiki/Task.md')).toBe(false);
		expect(tree.issues.map((issue) => issue.path)).toEqual(['Kit/Wiki/Lost.md', 'Kit/Wiki/Soil.md']);
	});

	test('cuts cycles deterministically regardless of input ordering and keeps branches reachable', () => {
		const pages = [page('C', '[[A]]'), page('B', '[[C]]'), page('A', '[[B]]'), page('D', '[[C]]'), page('Self', '[[Self]]')];
		const trees = [buildWikiTree(pages), buildWikiTree([...pages].reverse())];
		for (const tree of trees) {
			expect(tree.roots.map((node) => node.item.basename)).toEqual(['A', 'Self']);
			expect(descendants(tree, 'Kit/Wiki/A.md', 10).map((node) => node.item.basename)).toEqual(['C', 'B', 'D']);
			expect(tree.issues.map((issue) => [issue.path, issue.kind])).toEqual([
				['Kit/Wiki/A.md', 'cycle'], ['Kit/Wiki/B.md', 'cycle'], ['Kit/Wiki/C.md', 'cycle'], ['Kit/Wiki/Self.md', 'cycle'],
			]);
		}
	});

	test('returns breadcrumbs root-first and excludes the current page', () => {
		const tree = buildWikiTree([page('Recipes'), page('Tea', '[[Recipes]]'), page('Mint', '[[Tea]]')]);
		const path = breadcrumb(tree, 'Kit/Wiki/Mint.md');
		expect(path.map((node) => node.item.basename)).toEqual(['Recipes', 'Tea']);
		expect(breadcrumb(tree, 'missing')).toEqual([]);
		expect(breadcrumb(tree, 'Kit/Wiki/Recipes.md')).toEqual([]);
	});

	test('enforces the descendant depth boundary', () => {
		const tree = buildWikiTree([page('Recipes'), page('Tea', '[[Recipes]]'), page('Mint', '[[Tea]]')]);
		expect(descendants(tree, 'Kit/Wiki/Recipes.md', 0)).toEqual([]);
		expect(descendants(tree, 'Kit/Wiki/Recipes.md', 1).map((node) => node.item.basename)).toEqual(['Tea']);
		expect(descendants(tree, 'Kit/Wiki/Recipes.md', 2).map((node) => node.item.basename)).toEqual(['Tea', 'Mint']);
		expect(descendants(tree, 'missing', 2)).toEqual([]);
	});

	test('handles an empty index and a deep hierarchy without recursive stack growth', () => {
		const pages = Array.from({ length: 3000 }, (_, i) => page(`Page ${i}`, i > 0 ? `[[Page ${i - 1}]]` : undefined));
		const tree = buildWikiTree(pages);
		expect(descendants(tree, 'Kit/Wiki/Page 0.md', 3000)).toHaveLength(2999);
		expect(breadcrumb(tree, 'Kit/Wiki/Page 2999.md')).toHaveLength(2999);
		expect(buildWikiTree([]).roots).toEqual([]);
	});

	test('parses bounded depth and rejects malformed block input', () => {
		expect(parseDepth('')).toBe(1);
		expect(parseDepth('depth: 2\n')).toBe(2);
		expect(parseDepth('depth: 20')).toBe(20);
		for (const source of ['depth: 0', 'depth: -1', 'depth: 21', 'depth: two', 'depth: 2\nother: true', 'depth: 1.5']) expect(parseDepth(source)).toBeNull();
	});
});

describe('wiki customization', () => {
	test('round-trips field order, internal opt-in, filter, sort and collapsed state', () => {
		const base = parsePreferences(null);
		const layout = moveField(toggleField({ shown: ['owner', 'due'] }, 'session', true), 'session', -1);
		const data = parseWikiData({ tree: { ...base, layout, status: 'published', sort: 'descending', collapsed: ['Kit/Wiki/Recipes.md'] }, children: { ...base, layout: { shown: [] } } });
		const restored = parseWikiData(JSON.parse(JSON.stringify(data)));
		expect(restored).toEqual(data);
		expect(restored.tree.layout.shown).toEqual(['owner', 'session', 'due']);
		expect(restored.children.layout.shown).toEqual([]);
	});

	test('defaults to human fields, removes garbage and preserves intentional empty layouts', () => {
		const defaults = parsePreferences(null);
		expect(defaults.layout.shown).toEqual(['status']);
		expect(defaults.layout.shown).not.toContain('session');
		expect(parsePreferences({ layout: { shown: ['owner', 2, 'owner', ''] }, status: 9, sort: 'bad', collapsed: [1, 'a', 'a'] })).toEqual({
			layout: { shown: ['owner'] }, status: '', sort: 'ascending', collapsed: ['a'],
		});
		expect(parsePreferences({ layout: { shown: [] } }).layout.shown).toEqual([]);
	});

	test('never invents owner, due date, status or completion verification', () => {
		const empty = page('Garden');
		for (const field of ['owner', 'due', 'status', 'verified']) expect(fieldValue(empty, field)).toBeNull();
		expect(fieldValue(page('Garden', undefined, 'Kit/Wiki', { verified: false }), 'verified')).toBe('false');
	});

	test('filters by status retaining ancestor context and sorts without mutating hierarchy', () => {
		const tree = buildWikiTree([page('Recipes'), { ...page('Tea', '[[Recipes]]'), status: 'published' }, page('Garden')]);
		const visible = visiblePaths([...tree.nodes.values()], 'published');
		expect([...visible].sort()).toEqual(['Kit/Wiki/Recipes.md', 'Kit/Wiki/Tea.md']);
		expect(sortedNodes(tree.roots, 'descending').map((node) => node.item.basename)).toEqual(['Recipes', 'Garden']);
		expect(tree.roots.map((node) => node.item.basename)).toEqual(['Garden', 'Recipes']);
		expect(visiblePaths([...tree.nodes.values()], 'archived').size).toBe(0);
	});
});

describe('wiki creation boundary', () => {
	const date = new Date(2026, 0, 2);
	test('prepares root-relative new page and parent-linked subpage requests', () => {
		const parent = page('Recipes', undefined, 'Kit/Wiki', { kit: 'wiki' });
		const root = prepareWikiPage('Kit', 'Tea', null, DEFAULT_SETTINGS.headings, date);
		const child = prepareWikiPage('Kit', 'Mint/Tea', parent, DEFAULT_SETTINGS.headings, date);
		expect(root.ok).toBe(true);
		expect(child.ok).toBe(true);
		if (root.ok) {
			expect(root.request.folder).toBe('Wiki');
			expect(root.request.content).toContain('parent: ""');
		}
		if (child.ok) {
			expect(child.request.title).toBe('Mint Tea');
			expect(child.request.content).toContain('parent: "[[Kit/Wiki/Recipes.md]]"');
			expect(child.request.content).toContain('kit: wiki');
			expect(child.request.content).toContain('created: 2026-01-02');
		}
	});

	test('produces no write request for invalid roots or empty titles', () => {
		for (const root of ['', '/', '.', '..', '.obsidian', 'Kit/../Other']) {
			const result = prepareWikiPage(root, 'Tea', null, DEFAULT_SETTINGS.headings, date);
			expect(result.ok).toBe(false);
			expect('request' in result).toBe(false);
		}
		expect(prepareWikiPage('Kit', ' ', null, DEFAULT_SETTINGS.headings, date).ok).toBe(false);
	});

	test('produces no subpage request for false, unknown, non-wiki or outside-root parents', () => {
		const parents = [
			page('Recipes', undefined, 'Kit/Wiki', { kit: false }),
			page('Recipes', undefined, 'Kit/Wiki', { kit: 'unknown' }),
			page('Recipes', undefined, 'Elsewhere', { kit: 'wiki' }),
			{ ...page('Recipes', undefined, 'Kit/Wiki', { kit: 'task' }), kind: 'task' as const },
		];
		for (const parent of parents) {
			const result = prepareWikiPage('Kit', 'Tea', parent, DEFAULT_SETTINGS.headings, date);
			expect(result.ok).toBe(false);
			expect('request' in result).toBe(false);
		}
	});
});
