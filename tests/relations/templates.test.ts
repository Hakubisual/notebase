import { describe, expect, test } from 'bun:test';
import { moveField, STANDARD_FIELDS, toggleField } from '../../src/core/fields';
import { renderTemplate } from '../../src/core/templates';
import {
	checkTemplateDestination, createTemplateNote, isTemplatePath, parseTemplatePreferences, readTemplate, saveTemplatePreferences,
	selectTemplateFields, splitTemplate, STARTER_TEMPLATES, templateFields, templateFolder, type YamlCodec,
} from '../../src/features/relations/templates';

const codec: YamlCodec = { parse: (source) => Bun.YAML.parse(source), stringify: (value) => Bun.YAML.stringify(value) };
const vars = { title: 'Garden review', date: '2026-04-05', time: '14:30', project: '[[Garden]]', parent: '[[Guide]]', folder: 'Notes' };

describe('template preferences and field selection', () => {
	test('defaults use the human catalogue and do not enable internal fields', () => {
		const preferences = parseTemplatePreferences(null);
		expect(preferences).toEqual({ folder: 'Templates', fields: { shown: [...STANDARD_FIELDS] }, picker: { shown: ['title', 'path'] }, filter: '', sort: 'path' });
		const properties = { kit: 'task', 'kit-target': 'Tasks', next: 'Water seedlings', agent: 'robot', owner: 'Gardener', verified: false };
		expect(templateFields(properties).slice(0, STANDARD_FIELDS.length)).toEqual([...STANDARD_FIELDS]);
		expect(templateFields(properties)).not.toContain('kit-target');
		expect(selectTemplateFields(properties, preferences.fields)).toEqual({
			kit: 'task', next: 'Water seedlings', due: '', owner: 'Gardener', status: '', priority: '', project: '', decision: '', related: '', verified: false,
		});
	});

	test('actual toggle and move choices determine the new frontmatter and persist in the nested shape', () => {
		const raw = { panel: { fields: ['owner'] }, other: 'preserve', templates: { folder: 'My templates', fields: { shown: ['next', 'owner', 'agent'] } } };
		const preferences = parseTemplatePreferences(raw);
		const fields = moveField(toggleField(preferences.fields, 'owner', false), 'agent', -1);
		const saved = saveTemplatePreferences(raw, { ...preferences, fields });
		expect(saved).toEqual({ panel: raw.panel, other: 'preserve', templates: { folder: 'My templates', fields: { shown: ['agent', 'next'] }, picker: { shown: ['title', 'path'] }, filter: '', sort: 'path' } });
		const restored = parseTemplatePreferences(JSON.parse(JSON.stringify(saved)));
		expect(restored).toEqual({ folder: 'My templates', fields: { shown: ['agent', 'next'] }, picker: { shown: ['title', 'path'] }, filter: '', sort: 'path' });
		expect(selectTemplateFields({ kit: 'task', owner: 'Gardener', agent: 'opted in', next: 'Water' }, restored.fields))
			.toEqual({ kit: 'task', agent: 'opted in', next: 'Water' });
		expect(Object.keys(selectTemplateFields({ kit: 'task', agent: 'opted in', next: 'Water' }, restored.fields)))
			.toEqual(['kit', 'agent', 'next']);
	});

	test('empty selection stays empty while kit opt-in cannot be removed', () => {
		const preferences = parseTemplatePreferences({ templates: { fields: { shown: [] } } });
		expect(() => selectTemplateFields({ kit: 'invalid', owner: 'Gardener' }, preferences.fields)).toThrow();
		expect(selectTemplateFields({ kit: 'decision' }, preferences.fields)).toEqual({ kit: 'decision' });
		expect(() => createTemplateNote('---\nkit: false\n---\nBody', 'Garden', vars, preferences.fields, codec)).toThrow();
		expect(selectTemplateFields({}, preferences.fields)).toEqual({ kit: 'record' });
	});

	test('invalid persisted folders fall back and malformed fields are cleaned', () => {
		expect(parseTemplatePreferences({ templates: { folder: '../Outside', fields: { shown: ['next', 'next', 2, '', 'agent'] } } }))
			.toEqual({ folder: 'Templates', fields: { shown: ['next', 'agent'] }, picker: { shown: ['title', 'path'] }, filter: '', sort: 'path' });
		expect(parseTemplatePreferences({ folder: 'legacy', fields: { shown: [] } }).folder).toBe('Templates');
	});
});

describe('template paths', () => {
	test('relative folder normalization and defaults', () => {
		expect(templateFolder(undefined)).toBe('Notes');
		expect(templateFolder('  ')).toBe('Notes');
		expect(templateFolder('Archive\\Reading')).toBe('Archive/Reading');
		expect(templateFolder('', 'Templates')).toBe('Templates');
	});

	test('rejects absolute paths, traversal and malformed folder types before a request is created', () => {
		for (const target of ['/Outside', '\\Outside', 'C:\\Outside', '//host/share', '../Outside', 'Notes/../../Outside', './Notes', 'Notes/ .. /Outside', 'Notes\nOutside']) {
			expect(() => templateFolder(target)).toThrow();
			const source = `---\n${codec.stringify({ 'kit-target': target })}\n---\n# {{title}}`;
			expect(() => createTemplateNote(source, 'Garden', vars, { shown: [] }, codec)).toThrow();
		}
		for (const target of [2, {}, []]) expect(() => templateFolder(target)).toThrow();
	});

	test('owned writer destinations reject invalid roots, hidden folders and outside-root routing', () => {
		for (const root of ['', '/', '.', '..', 'Kit/..', '.obsidian', 'Kit/.hidden']) {
			expect(() => checkTemplateDestination(root, 'Notes')).toThrow();
			expect(isTemplatePath(root, 'Templates', 'Kit/Templates/A.md')).toBe(false);
		}
		for (const folder of ['../Outside', '/Outside', '.obsidian', 'Notes/.hidden']) {
			expect(() => checkTemplateDestination('Kit', folder)).toThrow();
		}
		expect(() => checkTemplateDestination('Kit', 'Notes/Garden')).not.toThrow();
	});

	test('picker includes only Markdown descendants inside the configured kit templates folder', () => {
		expect(isTemplatePath('Kit', 'Templates', 'Kit/Templates/Meeting.md')).toBe(true);
		expect(isTemplatePath('Kit', 'Templates', 'Kit/Templates/Weekly/Review.md')).toBe(true);
		for (const path of ['Other/Templates/A.md', 'Kit/Templates-old/A.md', 'Kit/Templates/A.csv', 'Kit/Templates/../A.md']) {
			expect(isTemplatePath('Kit', 'Templates', path)).toBe(false);
		}
	});
});

describe('template rendering', () => {
	test('uses core replacement semantics for whitespace, repeats, unknown variables and literal replacement characters', () => {
		expect(renderTemplate('{{ title }} {{title}} {{missing}}', { title: '$& {{date}}' })).toBe('$& {{date}} $& {{date}} {{missing}}');
		const note = createTemplateNote('# {{title}}\n{{date}} {{time}} {{project}} {{parent}} {{folder}} {{missing}}', vars.title, vars, { shown: [] }, codec);
		expect(note.folder).toBe('Notes');
		expect(note.content).toContain('# Garden review\n2026-04-05 14:30 [[Garden]] [[Guide]] Notes {{missing}}');
		expect(readTemplate(note.content, codec).properties).toEqual({ kit: 'record' });
		const withProject = createTemplateNote('Body only', vars.title, vars, { shown: ['project'] }, codec);
		expect(readTemplate(withProject.content, codec).properties).toEqual({ kit: 'record', project: '[[Garden]]' });
	});

	test('handles BOM, CRLF, closing dots and body delimiters without swallowing the body', () => {
		const source = '\uFEFF---\r\nkit: wiki\r\nparent: "{{parent}}"\r\n...\r\n# {{title}}\r\n---\r\nBody';
		expect(readTemplate(source, codec, vars)).toEqual({ properties: { kit: 'wiki', parent: '[[Guide]]' }, body: '# Garden review\r\n---\r\nBody' });
		expect(splitTemplate('---\n---\nBody')).toEqual({ yaml: '', body: 'Body' });
		expect(readTemplate('---\n---\nBody', { parse: () => undefined, stringify: codec.stringify })).toEqual({ properties: {}, body: 'Body' });
	});

	test('rejects malformed, unterminated and nonmapping frontmatter', () => {
		for (const source of ['---\nkit: task', '---\n- task\n---\n', '---\nplain scalar\n---\n', '---\nfield: [unterminated\n---\n']) {
			expect(() => readTemplate(source, codec, vars)).toThrow();
		}
		expect(() => createTemplateNote('# Note', '   ', vars, { shown: [] }, codec)).toThrow('Enter a title');
	});

	test('round-trips valid nested fields, block scalars, booleans and lists with field filtering', () => {
		const source = '---\nkit: task\nkit-target: Tasks/Garden\nnext: |\n  Water {{title}}\n  Check seedlings\nrelated:\n  - "{{parent}}"\nverified: false\npriority: 0\ncustom:\n  label: "{{project}}"\n  values: [one, two]\nagent: robot\n---\n# {{title}}';
		const fields = { shown: ['next', 'related', 'verified', 'priority', 'custom'] };
		const request = createTemplateNote(source, vars.title, vars, fields, codec);
		expect(request.folder).toBe('Tasks/Garden');
		expect(readTemplate(request.content, codec).properties).toEqual({
			kit: 'task', next: 'Water Garden review\nCheck seedlings\n', related: ['[[Guide]]'], verified: false, priority: 0,
			custom: { label: '[[Garden]]', values: ['one', 'two'] },
		});
	});

	test('hostile title and project values cannot inject YAML keys, change kind or escape routing', () => {
		const title = '"\nkit: project\nkit-target: /Outside\nowner: Injected\n---\n\\quoted: $& {{project}}';
		const project = "[[Garden]]\nverified: true\n'\"\\: # comment";
		const source = '---\nkit: task\nkit-target: Tasks\nname: {{title}}\nproject: "{{project}}"\nrelated: ["{{parent}}"]\n---\n# {{title}}';
		const request = createTemplateNote(source, title, { ...vars, project }, { shown: ['name', 'project', 'related'] }, codec);
		expect(request.folder).toBe('Tasks');
		expect(readTemplate(request.content, codec).properties).toEqual({ kit: 'task', name: title, project, related: ['[[Guide]]'] });
	});

	test('template marker collisions do not expand user values recursively', () => {
		const source = '---\nname: "{{title}}"\ncustom: OBTION_TEMPLATE_VALUE_\n---\n{{title}}';
		const request = createTemplateNote(source, 'OBTION_TEMPLATE_VALUE_1_END {{project}}', vars, { shown: ['name', 'custom'] }, codec);
		expect(readTemplate(request.content, codec).properties.name).toBe('OBTION_TEMPLATE_VALUE_1_END {{project}}');
	});
});

describe('starter templates', () => {
	test('provides four synthetic templates with no invented owner, due or verification', () => {
		expect(STARTER_TEMPLATES.map((template) => template.title)).toEqual(['Meeting note', 'Weekly review', 'Bug report', 'Reading note']);
		for (const template of STARTER_TEMPLATES) {
			expect(/^# /m.test(template.content)).toBe(false);
			const original = readTemplate(template.content, codec, vars);
			expect(original.properties.kit).toBe('record');
			for (const field of ['owner', 'due', 'verified']) expect(original.properties[field]).toBeUndefined();
			const created = createTemplateNote(template.content, vars.title, vars, parseTemplatePreferences(null).fields, codec);
			const properties = readTemplate(created.content, codec).properties;
			expect(created.folder).toBe('Notes');
			expect(properties['kit-target']).toBeUndefined();
			for (const field of ['owner', 'due', 'verified']) expect(properties[field]).toBe('');
		}
	});
});
