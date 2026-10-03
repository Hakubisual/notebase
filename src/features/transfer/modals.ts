import { FuzzySuggestModal, Modal, Notice, Setting, TFile, TFolder } from 'obsidian';
import type { KitContext } from '../../core/context';
import { filesUnder } from '../../core/index-service';
import { moveField, STANDARD_FIELDS, toggleField } from '../../core/fields';
import { sanitizeFileName } from '../../core/paths';
import { isoDate } from '../../core/templates';
import { exportCsv, exportMarkdown, exportRow, fieldLabel, fieldValue, parseTransferPreferences, selectRows } from './export';
import type { ExportRow, TransferPreferences } from './export';
import { isTransferKind, planNotionImport, renderImportNote, TRANSFER_KINDS } from './notion';
import type { ImportPlan, SourceText } from './notion';
import { transferRequest } from './write';

class FolderPicker extends FuzzySuggestModal<TFolder> {
	constructor(ctx: KitContext, private readonly choose: (folder: TFolder) => void) {
		super(ctx.app);
		this.setPlaceholder('Choose an extracted export folder');
	}
	getItems(): TFolder[] { return this.app.vault.getAllFolders(true); }
	getItemText(folder: TFolder): string { return folder.path || '/'; }
	onChooseItem(folder: TFolder): void { this.choose(folder); }
}

export class TransferModal extends Modal {
	protected preferences: TransferPreferences;
	protected closed = false;
	protected busy = false;
	constructor(protected readonly ctx: KitContext, private readonly released: () => void) {
		super(ctx.app);
		this.preferences = parseTransferPreferences(ctx.featureData('transfer'));
	}
	onClose(): void { this.closed = true; this.contentEl.empty(); this.released(); }
	protected frame(title: string): void {
		this.contentEl.empty();
		this.contentEl.addClass('obtion-transfer');
		this.contentEl.createEl('h2', { text: title });
	}
	protected async save(): Promise<void> { await this.ctx.setFeatureData('transfer', this.preferences); }
	protected async perform(action: () => Promise<void>): Promise<void> {
		if (this.busy) return;
		this.busy = true;
		try { await action(); }
		catch (error) { new Notice(error instanceof Error ? error.message : String(error)); }
		finally { this.busy = false; }
	}
}

export class ImportModal extends TransferModal {
	private folder: TFolder | undefined;
	private plan: ImportPlan | undefined;
	private destination = '';
	private created = 0;
	onOpen(): void { this.render(); }
	private render(): void {
		if (this.closed) return;
		this.frame('Import an extracted Notion export');
		this.contentEl.createEl('p', { text: 'Unzip a Markdown & CSV export into your vault first. Source files are read only. Attachments are not copied.' });
		new Setting(this.contentEl).setName('Source folder').setDesc(this.folder?.path || 'Not selected')
			.addButton((button) => button.setButtonText('Choose folder').onClick(() => {
				const picker = new FolderPicker(this.ctx, (folder) => { this.folder = folder; this.plan = undefined; this.created = 0; this.render(); });
				this.ctx.plugin.register(() => picker.close());
				picker.open();
			}));
		new Setting(this.contentEl).setName('CSV note kind').setDesc('Standalone Markdown pages become wiki notes.')
			.addDropdown((dropdown) => {
				for (const kind of TRANSFER_KINDS) dropdown.addOption(kind, fieldLabel(kind));
				dropdown.setValue(this.preferences.importKind).onChange((kind) => {
					if (!isTransferKind(kind)) return;
					this.preferences = { ...this.preferences, importKind: kind }; this.plan = undefined; this.created = 0; this.render();
				});
			});
		new Setting(this.contentEl).setName('Preview before writing').addButton((button) => button
			.setButtonText('Run dry run').setDisabled(!this.folder).onClick(() => this.perform(async () => {
				const folder = this.folder;
				if (!folder) return;
				this.frame('Reading source files');
				this.contentEl.createEl('p', { text: 'No notes have been written. Close to cancel.' });
				try {
					await this.save();
					const sources: SourceText[] = [];
					for (const file of filesUnder(this.app, folder)) {
						if (this.closed) return;
						sources.push({ path: file.path, content: /^(md|csv)$/i.test(file.extension) ? await this.app.vault.read(file) : '' });
					}
					this.plan = planNotionImport(sources, this.preferences.importKind);
					this.created = 0;
					this.destination = `Imports/${sanitizeFileName(folder.name || 'Vault')} ${isoDate(new Date())}`;
				} finally { this.render(); }
			})));
		const plan = this.plan;
		if (!plan) return;
		this.contentEl.createEl('p', { text: `${plan.notes.length} notes, ${plan.skipped} skipped. ${this.created} already created.` });
		this.contentEl.createEl('p', { text: `Destination: ${this.ctx.settings().rootFolder}/${this.destination}` });
		this.contentEl.createEl('p', { cls: 'obtion-transfer-muted', text: 'CSV rows merge with matching pages in the database folder. Existing names get a numeric suffix; title-based links may need review when names collide.' });
		if (plan.issues.length) {
			const details = this.contentEl.createEl('details');
			details.createEl('summary', { text: 'Skipped input details' });
			for (const issue of plan.issues) details.createEl('p', { text: issue });
		}
		new Setting(this.contentEl).setName('Create new notes').setDesc('Only this confirmation writes notes. Nothing is overwritten.')
			.addButton((button) => button.setButtonText('Confirm import').setCta().setDisabled(this.created >= plan.notes.length)
				.onClick(() => this.perform(async () => {
					this.frame('Importing notes');
					const progress = this.contentEl.createEl('p', { text: `${this.created} of ${plan.notes.length} created. Close to stop after the current note.` });
					try {
						while (this.created < plan.notes.length && !this.closed) {
							const note = plan.notes[this.created];
							if (!note) break;
							await this.ctx.writer.createNote(transferRequest(this.ctx.settings().rootFolder, { folder: this.destination, title: note.title, content: renderImportNote(note) }));
							this.created++;
							progress.setText(`${this.created} of ${plan.notes.length} created.`);
						}
					} finally {
						new Notice(`Import: ${this.created} of ${plan.notes.length} notes created. Source files unchanged.`);
						this.render();
					}
				})));
	}
}

export class ExportModal extends TransferModal {
	private rows: readonly ExportRow[] = [];
	private preview: HTMLElement | undefined;
	onOpen(): void { void this.perform(async () => { await this.load(); }); }
	private async load(): Promise<void> {
		this.frame('Loading export preview');
		const rows: ExportRow[] = [];
		for (const item of this.ctx.index.byKind(this.preferences.kind)) {
			if (this.closed) return;
			const file = this.app.vault.getAbstractFileByPath(item.path);
			if (!(file instanceof TFile)) continue;
			rows.push(exportRow(item, item.kind === 'project' ? await this.app.vault.read(file) : '', this.ctx.settings().headings));
		}
		this.rows = rows;
		this.render();
	}
	private render(): void {
		if (this.closed) return;
		this.frame('Export notes');
		this.contentEl.createEl('p', { text: 'CSV uses the fixed Notion columns. Preview and Markdown use your chosen fields. Empty values stay empty.' });
		new Setting(this.contentEl).setName('Note kind').addDropdown((dropdown) => {
			for (const kind of TRANSFER_KINDS) dropdown.addOption(kind, fieldLabel(kind));
			dropdown.setValue(this.preferences.kind).onChange((kind) => this.perform(async () => {
				if (!isTransferKind(kind)) return;
				this.preferences = { ...this.preferences, kind, status: '' }; await this.load();
			}));
		});
		new Setting(this.contentEl).setName('Status filter').setDesc('Exact match; leave empty for all statuses.')
			.addText((text) => text.setValue(this.preferences.status).onChange((status) => { this.preferences = { ...this.preferences, status }; this.renderPreview(); }));
		new Setting(this.contentEl).setName('Name filter').addText((text) => text.setValue(this.preferences.query)
			.onChange((query) => { this.preferences = { ...this.preferences, query }; this.renderPreview(); }));
		const fields = [...new Set(['name', ...STANDARD_FIELDS, ...this.preferences.layout.shown, ...this.rows.flatMap((row) => Object.keys(row.values))])];
		new Setting(this.contentEl).setName('Sort by').addDropdown((dropdown) => {
			for (const field of [...new Set([...fields, this.preferences.sort])]) dropdown.addOption(field, fieldLabel(field));
			dropdown.setValue(this.preferences.sort).onChange((sort) => { this.preferences = { ...this.preferences, sort }; this.renderPreview(); });
		}).addToggle((toggle) => toggle.setTooltip('Descending').setValue(this.preferences.descending)
			.onChange((descending) => { this.preferences = { ...this.preferences, descending }; this.renderPreview(); }));
		const details = this.contentEl.createEl('details');
		details.createEl('summary', { text: 'Customize fields' });
		const controls = details.createDiv();
		const renderFields = (): void => {
			controls.empty();
			for (const field of [...this.preferences.layout.shown, ...fields.filter((f) => !this.preferences.layout.shown.includes(f))]) {
				const index = this.preferences.layout.shown.indexOf(field);
				new Setting(controls).setName(fieldLabel(field)).addToggle((toggle) => toggle.setValue(index >= 0)
					.onChange((on) => { this.preferences = { ...this.preferences, layout: toggleField(this.preferences.layout, field, on) }; renderFields(); this.renderPreview(); }))
					.addButton((button) => button.setButtonText('Up').setDisabled(index <= 0).onClick(() => {
						this.preferences = { ...this.preferences, layout: moveField(this.preferences.layout, field, -1) }; renderFields(); this.renderPreview();
					}))
					.addButton((button) => button.setButtonText('Down').setDisabled(index < 0 || index === this.preferences.layout.shown.length - 1).onClick(() => {
						this.preferences = { ...this.preferences, layout: moveField(this.preferences.layout, field, 1) }; renderFields(); this.renderPreview();
					}));
			}
		};
		renderFields();
		new Setting(this.contentEl).setName('Remember these choices').setDesc('Save fields, order, filters and sorting before closing.')
			.addButton((button) => button.setButtonText('Save choices').onClick(() => this.perform(async () => { await this.save(); new Notice('Transfer choices saved.'); })));
		this.preview = this.contentEl.createDiv({ cls: 'obtion-transfer-preview' });
		this.renderPreview();
		new Setting(this.contentEl).setName('Create export files').setDesc('Creates CSV and Markdown in the export folder. Existing files receive a new name.')
			.addButton((button) => button.setButtonText('Export files').setCta().onClick(() => this.perform(async () => {
				const selected = selectRows(this.rows, this.preferences);
				const title = `${this.preferences.kind}-${isoDate(new Date())}`;
				const csv = exportCsv(this.preferences.kind, selected);
				const markdown = exportMarkdown(selected, this.preferences.layout);
				this.frame('Writing export files');
				const paths: string[] = [];
				try {
					await this.save();
					if (this.closed) return;
					paths.push((await this.ctx.writer.createNote(transferRequest(this.ctx.settings().rootFolder, { folder: 'Exports', title, extension: 'csv', content: csv }))).path);
					paths.push((await this.ctx.writer.createNote(transferRequest(this.ctx.settings().rootFolder, { folder: 'Exports', title, content: markdown }))).path);
				} finally {
					this.render();
					if (paths.length) {
						new Notice(`Created ${paths.length} export files: ${paths.join(', ')}`);
						if (!this.closed) this.contentEl.createEl('p', { text: `Created: ${paths.join(', ')}` });
					}
				}
			})));
	}
	private renderPreview(): void {
		const preview = this.preview;
		if (!preview) return;
		preview.empty();
		const rows = selectRows(this.rows, this.preferences);
		preview.createEl('p', { text: `${rows.length} notes match. Preview shows up to 20; all matching notes are exported.` });
		for (const row of rows.slice(0, 20)) {
			const card = preview.createDiv({ cls: 'obtion-transfer-row' });
			for (const field of this.preferences.layout.shown) {
				const line = card.createDiv();
				line.createEl('strong', { text: `${fieldLabel(field)}: ` });
				const value = fieldValue(row, field);
				line.createSpan({ text: value || 'Not set', cls: value ? '' : 'obtion-transfer-muted' });
			}
		}
	}
}
