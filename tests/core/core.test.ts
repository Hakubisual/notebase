import { describe, expect, test } from 'bun:test';
import { checkKitNoteEdit } from '../../src/core/guards';
import { checkRootFolder, isInsideRoot, sanitizeFileName, uniquePath } from '../../src/core/paths';
import { parseProjectSections, summarizeProject } from '../../src/core/sections';
import { DEFAULT_SETTINGS, parseSettings, parseSettingsChecked } from '../../src/core/settings';
import { builtinTemplate, renderTemplate } from '../../src/core/templates';
import { parseKitItem, parseLinkText } from '../../src/core/types';

const H = DEFAULT_SETTINGS.headings;

describe('paths', () => {
	test('isInsideRoot accepts the root and children only', () => {
		expect(isInsideRoot('Kit', 'Kit/Projects/A.md')).toBe(true);
		expect(isInsideRoot('Kit', 'Kit')).toBe(true);
		expect(isInsideRoot('Kit', 'Kitchen/A.md')).toBe(false);
		expect(isInsideRoot('Kit', 'Other/A.md')).toBe(false);
		expect(isInsideRoot('Kit', 'Kit/../Other/A.md')).toBe(false);
		expect(isInsideRoot('Kit', 'Kit/./A.md')).toBe(false);
	});

	test('an empty or invalid root contains nothing (never the whole vault)', () => {
		for (const root of ['', '/', '  ', '..', 'Kit/..', 'a/../b', '.obsidian', 'Kit/.hidden', './Kit']) {
			expect(checkRootFolder(root).ok).toBe(false);
			expect(isInsideRoot(root, 'Welcome.md')).toBe(false);
			expect(isInsideRoot(root, 'Kit/A.md')).toBe(false);
		}
		expect(checkRootFolder('\\My Kit\\Work/')).toEqual({ ok: true, root: 'My Kit/Work' });
	});

	test('uniquePath never returns an existing path', () => {
		const taken = new Set(['Kit/Projects/Alpha.md', 'Kit/Projects/Alpha 2.md']);
		expect(uniquePath('Kit/Projects', 'Alpha', 'md', (p) => taken.has(p))).toBe('Kit/Projects/Alpha 3.md');
		expect(uniquePath('Kit/Projects', 'Beta', 'md', (p) => taken.has(p))).toBe('Kit/Projects/Beta.md');
	});

	test('sanitizeFileName strips characters Obsidian cannot store', () => {
		expect(sanitizeFileName('a/b:c?[d]')).toBe('a b c d');
		expect(sanitizeFileName('   ')).toBe('Untitled');
	});
});

describe('sections', () => {
	const note = [
		'---',
		'kit: project',
		'---',
		'# Garden',
		'## 🧠 Principle',
		'- Grow from seed trays.',
		'## To do',
		'- [ ] Order soil',
		'- [x] Buy trays',
		'- [ ] Water plan',
		'```',
		'## Done',
		'- fake inside code fence',
		'```',
		'## Done',
		'- Built raised beds',
		'### Detail under done',
		'- Cedar boards',
		'## Verification limits',
		'- Harvest not measured yet.',
		'## Other',
		'- ignored',
	].join('\n');

	test('reads the four sections and ignores fenced code and other headings', () => {
		const s = parseProjectSections(note, H);
		expect(s.principle.map((e) => e.text)).toEqual(['Grow from seed trays.']);
		expect(s.todo.map((e) => e.checked)).toEqual([false, true, false]);
		expect(s.done.map((e) => e.text)).toEqual(['Built raised beds', 'Cedar boards']);
		expect(s.limits.map((e) => e.text)).toEqual(['Harvest not measured yet.']);
	});

	test('summary counts checked to-dos as done and computes progress', () => {
		const sum = summarizeProject(parseProjectSections(note, H));
		expect(sum.openCount).toBe(2);
		expect(sum.doneCount).toBe(3);
		expect(sum.progress).toBe(60);
		expect(sum.nextTodo).toBe('Order soil');
	});

	test('custom headings (e.g. Korean) are honoured', () => {
		const ko = { principle: '원리', todo: '해야 할 일', done: '끝난 일', limits: '검증 한계' };
		const s = parseProjectSections('## 원리\n- 하나\n## 해야 할 일\n- [ ] 둘\n## 끝난 일\n- 셋\n## 검증 한계\n- 넷', ko);
		expect(summarizeProject(s)).toMatchObject({ principle: '하나', nextTodo: '둘', latestDone: '셋', limit: '넷', progress: 50 });
	});

	test('empty project has null progress', () => {
		expect(summarizeProject(parseProjectSections('# Empty', H)).progress).toBeNull();
	});
});

describe('types', () => {
	test('parseLinkText strips brackets, alias and heading', () => {
		expect(parseLinkText('[[Garden Planner|GP]]')).toBe('Garden Planner');
		expect(parseLinkText('[[Garden#Plan]]')).toBe('Garden');
		expect(parseLinkText('')).toBeNull();
		expect(parseLinkText(3)).toBeNull();
	});

	test('parseKitItem only accepts opted-in notes', () => {
		const resolve = (link: string) => `Kit/Projects/${link}.md`;
		const base = { path: 'Kit/Tasks/T.md', basename: 'T', mtime: 1 };
		expect(parseKitItem({ ...base, frontmatter: { status: 'todo' } }, resolve)).toBeNull();
		expect(parseKitItem({ ...base, frontmatter: { kit: 'nope' } }, resolve)).toBeNull();
		const item = parseKitItem({ ...base, frontmatter: { kit: 'task', status: 'doing', project: '[[Garden]]' } }, resolve);
		expect(item).toMatchObject({ kind: 'task', status: 'doing', projectLink: 'Garden', projectPath: 'Kit/Projects/Garden.md' });
	});
});

describe('edit guard', () => {
	test('only known kit kinds inside the root are editable', () => {
		expect(checkKitNoteEdit('Kit', 'Kit/T.md', { kit: 'task' })).toEqual({ ok: true });
		for (const fm of [{ kit: false }, { kit: 'nope' }, { kit: '' }, { status: 'done' }, null, [], 'kit: task']) {
			expect(checkKitNoteEdit('Kit', 'Kit/T.md', fm)).toEqual({ ok: false, reason: 'not-kit-note' });
		}
		expect(checkKitNoteEdit('Kit', 'Other/T.md', { kit: 'task' })).toEqual({ ok: false, reason: 'outside-root' });
		expect(checkKitNoteEdit('', 'Kit/T.md', { kit: 'task' })).toEqual({ ok: false, reason: 'outside-root' });
	});
});

describe('settings and templates', () => {
	test('parseSettings fills defaults from garbage', () => {
		expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(parseSettingsChecked(null).rootError).toBeNull();
		expect(parseSettings({ rootFolder: '/My Kit/', headings: { todo: 'Next' } }).rootFolder).toBe('My Kit');
		expect(parseSettings({ headings: { todo: 'Next' } }).headings.todo).toBe('Next');
	});

	test('project template round-trips through the section parser', () => {
		const md = renderTemplate(builtinTemplate('project', H), { title: 'Alpha', date: '2026-01-02' });
		expect(md).toContain('kit: project');
		expect(md).not.toContain('# Alpha');
		const sum = summarizeProject(parseProjectSections(md, H));
		expect(sum.openCount).toBe(1);
		expect(sum.principle).not.toBeNull();
	});

	test('an invalid stored root falls back to the default and reports why instead of widening to the vault', () => {
		for (const rootFolder of ['/', '', '../Elsewhere', '.obsidian']) {
			const parsed = parseSettingsChecked({ rootFolder });
			expect(parsed.settings.rootFolder).toBe(DEFAULT_SETTINGS.rootFolder);
			expect(parsed.rootError).toContain(`"${rootFolder}"`);
		}
	});

	test('renderTemplate keeps unknown placeholders visible', () => {
		expect(renderTemplate('{{title}} {{missing}}', { title: 'X' })).toBe('X {{missing}}');
	});
});
