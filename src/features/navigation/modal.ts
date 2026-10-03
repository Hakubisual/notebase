import { Modal, Notice, Setting, SuggestModal } from 'obsidian';
import type { KitContext } from '../../core/context';
import { isInternalField, moveField, toggleField } from '../../core/fields';
import type { KitItem } from '../../core/types';
import { availableFields, fieldLabel, fieldValue, parsePreferences } from './preferences';
import type { NavigationPreferences } from './preferences';
import { searchItems } from './query';

export interface FindOptions {
	readonly recent?: boolean;
	readonly projectPath?: string;
	readonly query?: string;
}

export async function openItem(ctx: KitContext, item: KitItem, newTab = false): Promise<void> {
	const file = ctx.app.vault.getFileByPath(item.path);
	if (!file || !ctx.index.get(item.path)) {
		new Notice('This note is no longer available.');
		return;
	}
	await ctx.app.workspace.getLeaf(newTab ? 'tab' : false).openFile(file);
}

export class FindModal extends SuggestModal<KitItem> {
	private readonly preferences: NavigationPreferences;
	private unsubscribe: (() => void) | null = null;

	constructor(private readonly ctx: KitContext, private readonly activeModals: Set<Modal>, private readonly options: FindOptions) {
		super(ctx.app);
		this.preferences = parsePreferences(ctx.featureData('navigation'));
		this.modalEl.addClass('obtion-navigation');
		this.setPlaceholder(options.recent ? 'Recent notes' : 'Find note');
		this.emptyStateText = 'No notes match. Clear the search or change the saved filter in Customize.';
		this.setInstructions([
			{ command: 'Enter', purpose: 'Open' },
			{ command: 'Ctrl/Cmd+Enter', purpose: 'Open in new tab' },
			{ command: 'kind:task status:doing project:garden is:open', purpose: 'Filter; use "quoted phrases"' },
		]);
		this.scope.register(['Mod'], 'Enter', (event) => {
			this.selectActiveSuggestion(event);
			return false;
		});
	}

	async onOpen(): Promise<void> {
		this.activeModals.add(this);
		await super.onOpen();
		if (!this.activeModals.has(this)) return;
		const controls = this.modalEl.createDiv({ cls: 'obtion-navigation-controls' });
		this.resultContainerEl.before(controls);
		new Setting(controls)
			.setName(this.options.recent ? 'Recent notes' : 'Find note')
			.setDesc(this.options.projectPath ? `In project: ${this.ctx.index.get(this.options.projectPath)?.basename ?? this.options.projectPath}` : 'Search tracked notes')
			.addButton((button) => button.setButtonText('Customize').onClick(() => {
				const options = { ...this.options, query: this.inputEl.value };
				this.close();
				new CustomizeModal(this.ctx, this.activeModals, options).open();
			}));
		if (this.preferences.filter) controls.createDiv({ cls: 'obtion-navigation-muted', text: `Saved filter: ${this.preferences.filter}` });
		this.inputEl.value = this.options.query ?? '';
		this.refresh();
		this.unsubscribe = this.ctx.index.onChange(() => this.refresh());
	}

	private refresh(): void {
		this.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
	}

	onClose(): void {
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.activeModals.delete(this);
		super.onClose();
	}

	getSuggestions(query: string): KitItem[] {
		const items = this.ctx.index.items().filter((item) => !this.options.projectPath || item.path === this.options.projectPath || item.projectPath === this.options.projectPath);
		// Parse filters separately: unfinished quotes in user input must not absorb saved tokens.
		const filtered = searchItems(items, this.preferences.filter);
		return searchItems(filtered, query, this.options.recent ? this.preferences.recentSort : this.preferences.sort);
	}

	renderSuggestion(item: KitItem, element: HTMLElement): void {
		const heading = element.createDiv({ cls: 'obtion-navigation-heading' });
		heading.createSpan({ cls: 'obtion-navigation-title', text: item.basename });
		heading.createSpan({ cls: 'obtion-navigation-badge', text: item.kind });
		element.createDiv({ cls: 'obtion-navigation-path', text: item.path });
		const fields = element.createDiv({ cls: 'obtion-navigation-fields' });
		for (const field of this.preferences.fields.shown) {
			const value = fieldValue(item, field);
			const row = fields.createDiv({ cls: value === null ? 'obtion-navigation-muted' : 'obtion-navigation-field' });
			row.createSpan({ cls: 'obtion-navigation-label', text: `${fieldLabel(field)}: ` });
			row.createSpan({ text: value ?? 'Not set' });
		}
	}

	onChooseSuggestion(item: KitItem, event: MouseEvent | KeyboardEvent): void {
		void openItem(this.ctx, item, event.ctrlKey || event.metaKey);
	}
}

class CustomizeModal extends Modal {
	private draft: NavigationPreferences;

	constructor(private readonly ctx: KitContext, private readonly activeModals: Set<Modal>, private readonly options: FindOptions) {
		super(ctx.app);
		this.draft = parsePreferences(ctx.featureData('navigation'));
		this.modalEl.addClass('obtion-navigation');
	}

	onOpen(): void {
		this.activeModals.add(this);
		this.render();
	}

	private render(): void {
		this.contentEl.empty();
		this.setTitle('Customize navigation');
		new Setting(this.contentEl).setName('Saved filter').setDesc('Applies to find and recent items. Leave empty for all notes.')
			.addText((text) => text.setPlaceholder('Kind:task is:open').setValue(this.draft.filter).onChange((filter) => { this.draft = { ...this.draft, filter }; }));
		const sortKey = this.options.recent ? 'recentSort' : 'sort';
		new Setting(this.contentEl).setName('Sort').addDropdown((dropdown) => dropdown
			.addOption('relevance', 'Best match').addOption('title', 'Title').addOption('recent', 'Recently modified')
			.setValue(this.draft[sortKey]).onChange((value) => {
				if (value === 'relevance' || value === 'title' || value === 'recent') this.draft = { ...this.draft, [sortKey]: value };
			}));
		this.contentEl.createEl('p', { text: 'Show the fields you need. Move visible fields up or down to change their order.' });
		for (const field of availableFields(this.ctx.index.items(), this.draft.fields)) {
			const position = this.draft.fields.shown.indexOf(field);
			new Setting(this.contentEl).setName(fieldLabel(field)).setDesc(isInternalField(field) ? 'Internal field (hidden by default)' : '')
				.addToggle((toggle) => toggle.setValue(position >= 0).onChange((on) => {
					this.draft = { ...this.draft, fields: toggleField(this.draft.fields, field, on) };
					this.render();
				}))
				.addButton((button) => button.setButtonText('Up').setTooltip(`Move ${fieldLabel(field)} up`).setDisabled(position <= 0).onClick(() => {
					this.draft = { ...this.draft, fields: moveField(this.draft.fields, field, -1) };
					this.render();
				}))
				.addButton((button) => button.setButtonText('Down').setTooltip(`Move ${fieldLabel(field)} down`).setDisabled(position < 0 || position === this.draft.fields.shown.length - 1).onClick(() => {
					this.draft = { ...this.draft, fields: moveField(this.draft.fields, field, 1) };
					this.render();
				}));
		}
		new Setting(this.contentEl).addButton((button) => button.setButtonText('Save').setCta().onClick(async () => {
			button.setDisabled(true);
			try {
				await this.ctx.setFeatureData('navigation', this.draft);
				this.close();
			} catch (error) {
				new Notice(`Could not save navigation preferences: ${error instanceof Error ? error.message : String(error)}`);
				button.setDisabled(false);
			}
		})).addButton((button) => button.setButtonText('Cancel').onClick(() => this.close()));
	}

	/** The registry is cleared before plugin teardown closes modals. */
	onClose(): void {
		const reopen = this.activeModals.has(this);
		this.activeModals.delete(this);
		this.contentEl.empty();
		if (reopen) new FindModal(this.ctx, this.activeModals, this.options).open();
	}
}
