import { describe, expect, test } from 'bun:test';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import { DbConfigError, parseDbQuery } from '../../src/features/database/query';
import { editProperty, newNoteRequest } from '../../src/features/database/writes';

describe('database write boundary', () => {
	test('updates an opted-in scalar and preserves unrelated frontmatter', () => {
		const fm = { kit: 'task', owner: 'Garden team', status: 'todo', tags: ['garden'] };
		editProperty('Kit', 'Kit/Basil.md', fm, 'owner', 'Reading team');
		expect(fm).toEqual({ kit: 'task', owner: 'Reading team', status: 'todo', tags: ['garden'] });
	});
	test.each([
		{ root: 'Kit', path: 'Kit/Basil.md', kit: false },
		{ root: 'Kit', path: 'Kit/Basil.md', kit: 'unknown' },
		{ root: 'Kit', path: 'Other/Basil.md', kit: 'task' },
		{ root: '', path: 'Kit/Basil.md', kit: 'task' },
		{ root: '/', path: 'Kit/Basil.md', kit: 'task' },
		{ root: 'Kit/..', path: 'Kit/Basil.md', kit: 'task' },
		{ root: '.obsidian', path: '.obsidian/Basil.md', kit: 'task' },
	])('rejects unsafe edit %# without mutation', ({ root, path, kit }) => {
		const fm = { kit, owner: 'Garden team' };
		expect(() => editProperty(root, path, fm, 'owner', 'Changed')).toThrow(DbConfigError);
		expect(fm.owner).toBe('Garden team');
	});
	test('validates status against fresh kind when an indexed task became a wiki', () => {
		const fm = { kit: 'wiki', status: 'draft' };
		expect(() => editProperty('Kit', 'Kit/Basil.md', fm, 'status', 'doing')).toThrow(DbConfigError);
		expect(fm.status).toBe('draft');
	});
	test('refuses structured text edits and opt-in changes', () => {
		const fm = { kit: 'task', related: ['[[Basil]]'] };
		expect(() => editProperty('Kit', 'Kit/Basil.md', fm, 'related', 'Mint')).toThrow(DbConfigError);
		expect(() => editProperty('Kit', 'Kit/Basil.md', fm, 'kit', 'wiki')).toThrow(DbConfigError);
		expect(fm).toEqual({ kit: 'task', related: ['[[Basil]]'] });
	});
	test('creates a root-relative request with a known kit kind', () => {
		const request = newNoteRequest(parseDbQuery({ kind: 'record' }), 'Reading', '2026-10-02', DEFAULT_SETTINGS);
		expect(request.folder).toBe('');
		expect(Bun.YAML.parse(request.content.split('---')[1] ?? '')).toMatchObject({ kit: 'record', status: 'active' });
	});
	test.each(['', '/', '.', '..', '.obsidian', 'Kit/../Other'])('rejects creation with invalid root %s', (rootFolder) => {
		expect(() => newNoteRequest(parseDbQuery({}), 'Basil', '2026-10-02', { ...DEFAULT_SETTINGS, rootFolder })).toThrow(DbConfigError);
	});
});
