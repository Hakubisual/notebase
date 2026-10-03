import { Modal, Notice, parseYaml, Setting, stringifyYaml, SuggestModal, type TFile } from 'obsidian';
import type { KitContext } from '../../core/context';
import { checkKitNoteEdit } from '../../core/guards';
import { FIELD_LABELS, isInternalField, moveField, STANDARD_FIELDS, toggleField, type FieldLayout, type StandardField } from '../../core/fields';
import { filesUnder } from '../../core/index-service';
import { joinPath } from '../../core/paths';
import { isoDate } from '../../core/templates';
import {
	checkTemplateDestination, createTemplateNote, isTemplatePath, parseTemplatePreferences, readTemplate, saveTemplatePreferences,
	STARTER_TEMPLATES, templateFields, templateFolder, type TemplatePreferences, type YamlCodec,
} from './templates';

const YAML: YamlCodec = {
	parse: (source) => { const parsed: unknown = parseYaml(source); return parsed; },
	stringify: (value) => stringifyYaml(value),
};

function reportError(error: unknown): void {
	new Notice(error instanceof Error ? error.message : 'The template action could not be completed.');
}

function fieldLabel(field: string): string {
	const standard = STANDARD_FIELDS.find((name): name is StandardField => name === field);
	return standard === undefined ? field : FIELD_LABELS[standard];
}

class TemplatePicker extends SuggestModal<TFile> {
	private preferences: TemplatePreferences;
	constructor(private readonly ctx: KitContext, private readonly folder: string, private readonly choose: (file: TFile) => void,
		private readonly save: (preferences: TemplatePreferences) => Promise<void>) {
		super(ctx.app);
		this.preferences = parseTemplatePreferences(ctx.featureData('relations'));
		this.modalEl.addClass('obtion-relations', 'obtion-relations-template-picker');
		this.setPlaceholder('Choose a template');
		this.emptyStateText = 'No Markdown templates found. Install starter templates or change the templates folder in settings.';
	}

	async onOpen(): Promise<void> {
		await super.onOpen();
		const controls = this.contentEl.createEl('details', { cls: 'obtion-relations-customize' });
		this.contentEl.prepend(controls);
		controls.createEl('summary', { text: 'Customize template list' });
		const update = (next: TemplatePreferences): void => {
			this.preferences = next;
			void this.save(next).catch(reportError);
			this.inputEl.dispatchEvent(new Event('input'));
		};
		new Setting(controls).setName('Saved filter').addText((text) => text.setValue(this.preferences.filter).onChange((filter) => update({ ...this.preferences, filter })));
		new Setting(controls).setName('Sort').addDropdown((dropdown) => dropdown.addOptions({ title: 'Title', path: 'Folder and title' }).setValue(this.preferences.sort).onChange((sort) => update({ ...this.preferences, sort: sort === 'title' ? 'title' : 'path' })));
		const fields = controls.createDiv();
		const renderFields = (): void => {
			fields.empty();
			const ordered = [...new Set([...this.preferences.picker.shown, 'title', 'path'])];
			for (const field of ordered) {
				new Setting(fields).setName(field === 'title' ? 'Title' : 'Path').addToggle((toggle) => toggle.setValue(this.preferences.picker.shown.includes(field)).onChange((on) => {
					update({ ...this.preferences, picker: toggleField(this.preferences.picker, field, on) }); renderFields();
				})).addButton((button) => button.setButtonText('Up').onClick(() => {
					update({ ...this.preferences, picker: moveField(this.preferences.picker, field, -1) }); renderFields();
				})).addButton((button) => button.setButtonText('Down').onClick(() => {
					update({ ...this.preferences, picker: moveField(this.preferences.picker, field, 1) }); renderFields();
				}));
			}
		};
		renderFields();
	}

	getSuggestions(query: string): TFile[] {
		const root = this.ctx.settings().rootFolder;
		return filesUnder(this.ctx.app, joinPath(root, templateFolder(this.folder, 'Templates')), 'md')
			.filter((file) => isTemplatePath(this.ctx.settings().rootFolder, this.folder, file.path) && file.path.toLowerCase().includes(query.toLowerCase()) && file.path.toLowerCase().includes(this.preferences.filter.toLowerCase()))
			.sort((a, b) => (this.preferences.sort === 'title' ? a.basename.localeCompare(b.basename) : a.path.localeCompare(b.path)) || a.path.localeCompare(b.path));
	}

	renderSuggestion(file: TFile, el: HTMLElement): void {
		el.addClass('obtion-relations-template-option');
		el.setAttribute('aria-label', file.path);
		for (const field of this.preferences.picker.shown) el.createDiv({ text: field === 'title' ? file.basename : file.path, cls: field === 'path' ? 'obtion-relations-template-path' : '' });
		const button = el.createEl('button', { text: 'Edit template' });
		button.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.close();
			void this.ctx.app.workspace.getLeaf(false).openFile(file).catch(reportError);
		});
	}

	onChooseSuggestion(file: TFile): void {
		this.choose(file);
	}
}

class CreateTemplateModal extends Modal {
	private title = '';
	private project = '';
	private fields: FieldLayout;
	private available: readonly string[] = [];
	private ready = false;
	private creating = false;
	private openNow = false;

	constructor(private readonly ctx: KitContext, private readonly file: TFile, private readonly preferences: TemplatePreferences,
		private readonly save: (preferences: TemplatePreferences) => Promise<void>) {
		super(ctx.app);
		this.fields = preferences.fields;
	}

	onOpen(): void {
		this.openNow = true;
		this.modalEl.addClass('obtion-relations', 'obtion-relations-template-modal');
		this.titleEl.setText('New note from template');
		this.contentEl.createEl('p', { text: 'Loading template...' });
		void this.load().catch((error: unknown) => { reportError(error); this.close(); });
	}

	private async load(): Promise<void> {
		this.checkFile();
		const source = await this.ctx.app.vault.read(this.file);
		const document = readTemplate(source, YAML, { title: '', date: '', time: '', project: '', parent: '', folder: 'Notes' });
		this.available = templateFields(document.properties);
		this.ready = true;
		if (this.openNow) this.render();
	}

	private checkFile(): void {
		if (!isTemplatePath(this.ctx.settings().rootFolder, this.preferences.folder, this.file.path)) {
			throw new Error('This template is no longer inside the configured templates folder.');
		}
	}

	private render(): void {
		const el = this.contentEl;
		el.empty();
		new Setting(el).setName('Template').setDesc(this.file.path).addButton((button) => button.setButtonText('Edit template').onClick(() => {
			this.close();
			void this.ctx.app.workspace.getLeaf(false).openFile(this.file).catch(reportError);
		}));
		new Setting(el).setName('Title').addText((text) => text.setValue(this.title).setPlaceholder('Note title').onChange((value) => { this.title = value; }));
		new Setting(el).setName('Project').setDesc('Optional relation to a project.').addDropdown((dropdown) => {
			dropdown.addOption('', 'No project');
			for (const item of this.ctx.index.byKind('project')) dropdown.addOption(item.path, item.basename);
			dropdown.setValue(this.project).onChange((value) => { this.project = value; });
		});
		el.createEl('h3', { text: 'Fields for the new note' });
		el.createEl('p', { text: 'Choose fields and their order. Missing values stay empty. Kit opt-in is always included.' });
		const fieldEl = el.createDiv({ cls: 'obtion-relations-template-fields' });
		const renderFields = (): void => {
			fieldEl.empty();
			const ordered = [...new Set([...this.fields.shown.filter((field) => this.available.includes(field)), ...this.available])];
			for (const field of ordered) {
				const shown = this.fields.shown.includes(field);
				const setting = new Setting(fieldEl).setName(fieldLabel(field));
				if (isInternalField(field)) setting.setDesc('Internal property; off by default.');
				setting.addToggle((toggle) => toggle.setValue(shown).onChange((on) => {
					this.fields = toggleField(this.fields, field, on);
					renderFields();
				}));
				if (shown) {
					for (const delta of [-1, 1] as const) setting.addExtraButton((button) => button
						.setIcon(delta === -1 ? 'arrow-up' : 'arrow-down').setTooltip(delta === -1 ? 'Move field up' : 'Move field down')
						.onClick(() => { this.fields = moveField(this.fields, field, delta); renderFields(); }));
				}
			}
		};
		renderFields();
		new Setting(el).setName('Field choices').addButton((button) => button.setButtonText('Save field choices').onClick(() => {
			button.setDisabled(true);
			void this.save({ ...parseTemplatePreferences(this.ctx.featureData('relations')), fields: this.fields }).then(() => { new Notice('Template field choices saved.'); })
				.catch(reportError).finally(() => { button.setDisabled(false); });
		}));
		new Setting(el).addButton((button) => button.setButtonText('Create note').setCta().onClick(() => {
			if (this.creating || !this.ready) return;
			this.creating = true;
			button.setDisabled(true);
			void this.create().catch(reportError).finally(() => { this.creating = false; button.setDisabled(false); });
		}));
	}

	private async create(): Promise<void> {
		this.checkFile();
		const source = await this.ctx.app.vault.read(this.file);
		const now = new Date();
		const active = this.ctx.app.workspace.getActiveFile();
		const parentItem = active === null ? null : this.ctx.index.get(active.path);
		const parent = parentItem !== null && checkKitNoteEdit(this.ctx.settings().rootFolder, parentItem.path, parentItem.properties).ok
			? `[[${parentItem.path.replace(/\.md$/i, '')}]]` : '';
		const vars = {
			date: isoDate(now), time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
			project: this.project === '' ? '' : `[[${this.project.replace(/\.md$/i, '')}]]`, parent, folder: 'Notes',
		};
		vars.folder = templateFolder(readTemplate(source, YAML, { ...vars, title: this.title }).properties['kit-target']);
		const request = createTemplateNote(source, this.title, vars, this.fields, YAML);
		await this.save({ ...parseTemplatePreferences(this.ctx.featureData('relations')), fields: this.fields });
		checkTemplateDestination(this.ctx.settings().rootFolder, request.folder);
		const file = await this.ctx.writer.createNote(request);
		this.close();
		await this.ctx.app.workspace.getLeaf(false).openFile(file);
	}

	onClose(): void {
		this.openNow = false;
		this.contentEl.empty();
	}
}

export function registerTemplates(ctx: KitContext): void {
	const modals = new Set<Modal>();
	ctx.plugin.register(() => { for (const modal of modals) modal.close(); modals.clear(); });
	const open = (modal: Modal): void => {
		modals.add(modal);
		const close = modal.onClose.bind(modal);
		modal.onClose = () => { modals.delete(modal); close(); };
		modal.open();
	};
	let saveQueue: Promise<void> = Promise.resolve();
	const save = (preferences: TemplatePreferences): Promise<void> => {
		const pending = saveQueue.then(() => ctx.setFeatureData('relations', saveTemplatePreferences(ctx.featureData('relations'), preferences)));
		saveQueue = pending.catch(reportError);
		return pending;
	};
	ctx.addSettingsSection('Templates', (container) => {
		const el = container.createDiv({ cls: 'obtion-relations obtion-relations-template-settings' });
		let folder = parseTemplatePreferences(ctx.featureData('relations')).folder;
		new Setting(el).setName('Templates folder').setDesc('Inside the main folder from the settings above. Subfolders are included.')
			.addText((text) => text.setValue(folder).setPlaceholder('Templates').onChange((value) => { folder = value; }))
			.addButton((button) => button.setButtonText('Save folder').onClick(() => {
				try {
					const preferences = parseTemplatePreferences(ctx.featureData('relations'));
					const next = { ...preferences, folder: templateFolder(folder, 'Templates') };
					button.setDisabled(true);
					void save(next).then(() => { new Notice(`Templates folder saved: ${joinPath(ctx.settings().rootFolder, next.folder)}`); })
						.catch(reportError).finally(() => { button.setDisabled(false); });
				} catch (error: unknown) { reportError(error); }
			}));
	});
	ctx.plugin.addCommand({
		id: 'relations-new-from-template', name: 'New note from template',
		callback: () => {
			const preferences = parseTemplatePreferences(ctx.featureData('relations'));
			open(new TemplatePicker(ctx, preferences.folder, (file) => { open(new CreateTemplateModal(ctx, file, parseTemplatePreferences(ctx.featureData('relations')), save)); }, save));
		},
	});
	let installing = false;
	ctx.plugin.addCommand({
		id: 'relations-install-starter-templates', name: 'Install starter templates',
		callback: () => {
			if (installing) return;
			installing = true;
			const install = async (): Promise<void> => {
				const { folder } = parseTemplatePreferences(ctx.featureData('relations'));
				for (const template of STARTER_TEMPLATES) {
					checkTemplateDestination(ctx.settings().rootFolder, folder);
					await ctx.writer.createNote({ folder, ...template });
				}
				new Notice('Four starter templates installed without overwriting existing files.');
			};
			void install().catch(reportError).finally(() => { installing = false; });
		},
	});
}
