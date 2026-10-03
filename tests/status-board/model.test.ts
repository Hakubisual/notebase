import { describe, expect, test } from 'bun:test';
import { isInternalField, moveField, parseFieldLayout, toggleField, visibleByDefault } from '../../src/core/fields';
import { parseProjectSections, summarizeProject } from '../../src/core/sections';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import type { KitItem } from '../../src/core/types';
import { buildCard, DEFAULT_BOARD_OPTIONS, filterAndSort, parseBoardOptions, type BoardOptions } from '../../src/features/status-board/model';
import { SAMPLE_ITEMS, SAMPLE_PROJECTS } from '../../src/features/status-board/samples';

function item(partial: Partial<KitItem> & Pick<KitItem, 'path' | 'kind'>): KitItem {
	return {
		basename: partial.path.replace(/^.*\//, '').replace(/\.md$/, ''),
		status: null,
		projectLink: null,
		projectPath: null,
		properties: {},
		mtime: 0,
		...partial,
	};
}

const P = 'Kit/Projects/Garden.md';
const project = item({ path: P, kind: 'project', status: 'active', properties: { due: '2026-11-01' } });
const summary = summarizeProject(parseProjectSections('## Principle\n- Sun first\n## To do\n- [ ] Soil\n## Done\n- Beds\n## Verification limits\n- pH unknown', DEFAULT_SETTINGS.headings));

describe('buildCard', () => {
	test('never invents owner or completion when missing', () => {
		const card = buildCard(project, summary, [project], { shown: ['owner', 'next', 'decisions', 'related', 'limits'] });
		expect(card.rows.map((r) => [r.field, r.value])).toEqual([
			['owner', null],
			['next', 'Soil'],
			['decisions', null],
			['related', null],
			['limits', 'pH unknown'],
		]);
	});

	test('progress is null for a project without tasks, not 0% or 100%', () => {
		const empty = summarizeProject(parseProjectSections('## Principle\n- x', DEFAULT_SETTINGS.headings));
		expect(buildCard(project, empty, [project], DEFAULT_BOARD_OPTIONS.layout).progress).toBeNull();
	});

	test('rows follow the user-chosen order and only shown fields appear', () => {
		const card = buildCard(project, summary, [project], { shown: ['limits', 'due'] });
		expect(card.rows.map((r) => r.field)).toEqual(['limits', 'due']);
		expect(card.rows[1]?.value).toBe('2026-11-01');
	});

	test('decisions count open ones and link them', () => {
		const d1 = item({ path: 'Kit/Decisions/A.md', kind: 'decision', status: 'open', projectPath: P });
		const d2 = item({ path: 'Kit/Decisions/B.md', kind: 'decision', status: 'decided', projectPath: P });
		const t1 = item({ path: 'Kit/Tasks/T.md', kind: 'task', status: 'todo', projectPath: P });
		const card = buildCard(project, summary, [project, d1, d2, t1], { shown: ['decisions', 'related'] });
		expect(card.rows[0]).toMatchObject({ value: '1 open of 2', links: [{ title: 'A' }] });
		expect(card.rows[1]).toMatchObject({ value: '1', links: [{ title: 'T' }] });
	});
});

describe('filterAndSort', () => {
	const mk = (title: string, status: string, progress: number | null, due: string | null, mtime: number) =>
		buildCard(item({ path: `Kit/${title}.md`, kind: 'project', status, mtime, properties: due === null ? {} : { due } }), progress === null ? null : { ...summary, progress }, [], { shown: [] });
	const cards = [mk('B', 'active', 50, '2026-12-01', 1), mk('A', 'paused', null, null, 3), mk('C', 'done', 100, '2026-10-01', 2)];
	const opts = (o: Partial<BoardOptions>): BoardOptions => ({ ...DEFAULT_BOARD_OPTIONS, ...o });

	test('status filter hides done projects by default', () => {
		expect(filterAndSort(cards, DEFAULT_BOARD_OPTIONS).map((c) => c.title)).toEqual(['A', 'B']);
		expect(filterAndSort(cards, opts({ statuses: [] })).map((c) => c.title)).toEqual(['A', 'B', 'C']);
	});

	test('sorts by progress, due (missing last) and recency', () => {
		expect(filterAndSort(cards, opts({ statuses: [], sort: 'progress' })).map((c) => c.title)).toEqual(['C', 'B', 'A']);
		expect(filterAndSort(cards, opts({ statuses: [], sort: 'due' })).map((c) => c.title)).toEqual(['C', 'B', 'A']);
		expect(filterAndSort(cards, opts({ statuses: [], sort: 'updated' })).map((c) => c.title)).toEqual(['A', 'C', 'B']);
	});
});

describe('persisted options', () => {
	test('round-trip through JSON keeps the user layout, filter and sort', () => {
		const custom: BoardOptions = { layout: { shown: ['limits', 'owner'] }, statuses: ['done'], sort: 'due' };
		expect(parseBoardOptions(JSON.parse(JSON.stringify(custom)))).toEqual(custom);
	});

	test('garbage falls back to defaults and unknown fields are dropped', () => {
		expect(parseBoardOptions('nope')).toEqual(DEFAULT_BOARD_OPTIONS);
		expect(parseBoardOptions({ layout: { shown: ['owner', 'session', 7] }, sort: 'zzz' })).toEqual({ ...DEFAULT_BOARD_OPTIONS, layout: { shown: ['owner'] } });
	});
});

describe('fields', () => {
	test('internal AI/session fields are hidden by default', () => {
		expect(isInternalField('session')).toBe(true);
		expect(isInternalField('Tokens')).toBe(true);
		expect(isInternalField('owner')).toBe(false);
		expect(visibleByDefault(['owner', 'model', 'due', 'prompt'])).toEqual(['owner', 'due']);
	});

	test('move and toggle keep order stable', () => {
		const l = { shown: ['a', 'b', 'c'] };
		expect(moveField(l, 'c', -1).shown).toEqual(['a', 'c', 'b']);
		expect(moveField(l, 'a', -1)).toBe(l);
		expect(toggleField(l, 'b', false).shown).toEqual(['a', 'c']);
		expect(toggleField(l, 'd', true).shown).toEqual(['a', 'b', 'c', 'd']);
		expect(parseFieldLayout({ shown: ['a', 'a', ''] }, l).shown).toEqual(['a']);
	});
});

describe('samples', () => {
	test('samples are opted in, marked as samples and contain no real-looking identifiers', () => {
		const contents = [...SAMPLE_PROJECTS.map((s) => s.content), ...SAMPLE_ITEMS.map((s) => s.content('Garden planner'))];
		for (const content of contents) {
			expect(content).toMatch(/^---\nkit: (project|task|decision)\n/);
			expect(content).toContain('sample: true');
			expect(content).not.toMatch(/@|https?:|\b\d{12,}\b/);
		}
	});

	test('sample items link to the project name actually created (uniquified when the user already has one)', () => {
		const order = SAMPLE_ITEMS.find((s) => s.title === 'Order compost');
		expect(order?.content('Garden planner 2')).toContain('project: "[[Garden planner 2]]"');
		for (const s of SAMPLE_ITEMS) expect(SAMPLE_PROJECTS.some((p) => p.title === s.projectTitle)).toBe(true);
	});
});
