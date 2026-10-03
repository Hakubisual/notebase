import { ItemView, MarkdownRenderChild, MarkdownView, Notice, Setting } from 'obsidian';
import type { MarkdownPostProcessorContext, WorkspaceLeaf } from 'obsidian';
import type { KitContext } from '../../core/context';
import { displayValue, isInternalField, moveField, toggleField } from '../../core/fields';
import { KIT_KINDS } from '../../core/types';
import { incomingRelations, incomingRollup, outgoingRelations, parseRollupConfig, rollup } from './model';
import type { RelationGroup, ResolveRelation, Rollup } from './model';
import { arrangeEntries, fieldLabel, fieldNames, panelData, parsePanelPreferences, withPanelData } from './preferences';
import type { PanelPreferences } from './preferences';

export const RELATIONS_VIEW = 'obtion-relations';

function resolver(ctx: KitContext): ResolveRelation {
	return (target, sourcePath) => ctx.app.metadataCache.getFirstLinkpathDest(target, sourcePath)?.path ?? null;
}

function renderRollup(el: HTMLElement, summary: Rollup): void {
	const box = el.createDiv({ cls: 'obtion-relations-rollup' });
	box.createEl('p', { text: summary.total === 0 ? 'No related notes' : `${summary.total} related ${summary.total === 1 ? 'note' : 'notes'} · ${Math.round(summary.percentDone ?? 0)}% done` });
	if (summary.percentDone !== null) {
		const progress = box.createEl('progress', { attr: { max: '100', value: String(summary.percentDone), 'aria-label': 'Related notes done' } });
		progress.textContent = `${Math.round(summary.percentDone)}%`;
	}
	const counts = box.createDiv({ cls: 'obtion-relations-counts' });
	for (const { status, count } of summary.counts) counts.createSpan({ text: `${status ?? 'Not set'}: ${count}` });
}

export class RelationsView extends ItemView {
	private sourcePath: string | null = null;
	private preferences: PanelPreferences = parsePanelPreferences(undefined, []);
	private results: HTMLElement | null = null;
	private saveQueue: Promise<void> = Promise.resolve();

	constructor(leaf: WorkspaceLeaf, private readonly ctx: KitContext) { super(leaf); }
	getViewType(): string { return RELATIONS_VIEW; }
	getDisplayText(): string { return 'Relations'; }
	getIcon(): string { return 'links-coming-in'; }

	onOpen(): Promise<void> {
		this.sourcePath = this.ctx.app.workspace.getActiveFile()?.path ?? null;
		this.preferences = parsePanelPreferences(panelData(this.ctx.featureData('relations')), fieldNames(this.ctx.index.items()));
		this.registerEvent(this.ctx.app.workspace.on('active-leaf-change', (leaf) => {
			if (leaf?.view instanceof MarkdownView) {
				this.sourcePath = leaf.view.file?.path ?? null;
				this.render();
			}
		}));
		this.registerEvent(this.ctx.app.workspace.on('file-open', (file) => {
			// Focusing this side view may emit a null file; keep the note being inspected.
			if (file) {
				this.sourcePath = file.path;
				this.render();
			}
		}));
		this.register(this.ctx.index.onChange(() => this.render()));
		this.render();
		return Promise.resolve();
	}

	private save(next: PanelPreferences): void {
		this.preferences = next;
		this.renderResults();
		// Serialize local control changes so a slower older save cannot win.
		this.saveQueue = this.saveQueue.then(async () => {
			await this.ctx.setFeatureData('relations', withPanelData(this.ctx.featureData('relations'), next));
		}).catch((error: unknown) => {
			new Notice(`Could not save relations settings: ${error instanceof Error ? error.message : String(error)}`);
		});
	}

	private render(): void {
		const el = this.contentEl;
		el.empty();
		el.addClass('obtion-relations');
		const fields = fieldNames(this.ctx.index.items());
		el.createEl('h2', { text: 'Relations' });
		const controls = el.createEl('details', { cls: 'obtion-relations-customize' });
		controls.createEl('summary', { text: 'Customize' });
		new Setting(controls).setName('Filter').addText((input) => input.setPlaceholder('Related note or visible field').setValue(this.preferences.filter).onChange((filter) => this.save({ ...this.preferences, filter })));
		new Setting(controls).setName('Kind').addDropdown((dropdown) => {
			dropdown.addOption('', 'All kinds');
			for (const kind of KIT_KINDS) dropdown.addOption(kind, kind);
			dropdown.setValue(this.preferences.kind ?? '').onChange((value) => {
				const kind = KIT_KINDS.find((candidate) => candidate === value) ?? null;
				this.save({ ...this.preferences, kind });
			});
		});
		new Setting(controls).setName('Sort').addDropdown((dropdown) => dropdown.addOptions({ title: 'Title', status: 'Status', due: 'Due' }).setValue(this.preferences.sort).onChange((value) => {
			const sort = value === 'status' || value === 'due' ? value : 'title';
			this.save({ ...this.preferences, sort });
		}));
		const fieldControls = controls.createDiv();
		const renderFields = (): void => {
			fieldControls.empty();
			const ordered = [...this.preferences.layout.shown, ...fields.filter((field) => !this.preferences.layout.shown.includes(field))];
			for (const field of ordered) {
				const shown = this.preferences.layout.shown.includes(field);
				const index = this.preferences.layout.shown.indexOf(field);
				new Setting(fieldControls).setName(fieldLabel(field)).addToggle((toggle) => toggle.setValue(shown).onChange((on) => {
					this.save({ ...this.preferences, layout: toggleField(this.preferences.layout, field, on) });
					renderFields();
				})).addButton((button) => button.setButtonText('Up').setDisabled(!shown || index === 0).onClick(() => {
					this.save({ ...this.preferences, layout: moveField(this.preferences.layout, field, -1) });
					renderFields();
				})).addButton((button) => button.setButtonText('Down').setDisabled(!shown || index === this.preferences.layout.shown.length - 1).onClick(() => {
					this.save({ ...this.preferences, layout: moveField(this.preferences.layout, field, 1) });
					renderFields();
				}));
			}
		};
		renderFields();
		this.results = el.createDiv();
		this.renderResults();
	}

	private renderResults(): void {
		const el = this.results;
		if (!el) return;
		el.empty();
		const note = this.sourcePath === null ? null : this.ctx.index.get(this.sourcePath);
		if (!note) {
			el.createEl('p', { text: 'Open a project, task or other tracked note to see its relations.', cls: 'obtion-relations-muted' });
			return;
		}
		el.createEl('h3', { text: note.basename });
		const items = this.ctx.index.items();
		const resolve = resolver(this.ctx);
		this.renderGroups(el, 'Outgoing', outgoingRelations(note, items, resolve), note.path);
		this.renderGroups(el, 'Incoming', incomingRelations(note.path, items, resolve), note.path);
	}

	private renderGroups(el: HTMLElement, title: string, groups: readonly RelationGroup[], sourcePath: string): void {
		el.createEl('h3', { text: title });
		let visible = 0;
		for (const group of groups) {
			if (isInternalField(group.property) && !this.preferences.layout.shown.includes(group.property)) continue;
			const entries = arrangeEntries(group.entries, this.preferences);
			if (entries.length === 0) continue;
			visible++;
			const section = el.createEl('section', { cls: 'obtion-relations-group' });
			section.createEl('h4', { text: fieldLabel(group.property) });
			renderRollup(section, rollup(entries.flatMap((entry) => entry.item ? [entry.item] : [])));
			for (const entry of entries) {
				const row = section.createDiv({ cls: 'obtion-relations-note' });
				const link = row.createEl('a', { text: entry.label, href: entry.item?.path ?? entry.target, cls: 'internal-link' });
				link.addEventListener('click', (event) => {
					event.preventDefault();
					void this.ctx.app.workspace.openLinkText(entry.item?.path ?? entry.target, sourcePath, event.ctrlKey || event.metaKey);
				});
				if (entry.item === null) row.createEl('p', { text: 'Not indexed or unresolved; excluded from rollup.', cls: 'obtion-relations-muted' });
				else {
					const fields = row.createEl('dl', { cls: 'obtion-relations-fields' });
					for (const field of this.preferences.layout.shown) {
						fields.createEl('dt', { text: fieldLabel(field) });
						const value = displayValue(entry.item.properties[field]);
						fields.createEl('dd', { text: value ?? 'Not set', cls: value === null ? 'obtion-relations-muted' : '' });
					}
				}
			}
		}
		if (visible === 0) el.createEl('p', { text: 'No matching relations.', cls: 'obtion-relations-muted' });
	}
}

class RollupBlock extends MarkdownRenderChild {
	constructor(el: HTMLElement, private readonly ctx: KitContext, private readonly source: string, private readonly sourcePath: string) { super(el); }
	onload(): void {
		this.register(this.ctx.index.onChange(() => this.render()));
		this.render();
	}
	private render(): void {
		this.containerEl.empty();
		this.containerEl.addClass('obtion-relations');
		const config = parseRollupConfig(this.source);
		if (typeof config === 'string') {
			this.containerEl.createEl('p', { text: config });
			return;
		}
		if (!this.ctx.index.get(this.sourcePath)) {
			this.containerEl.createEl('p', { text: 'Rollups work inside tracked notes only.' });
			return;
		}
		this.containerEl.createEl('h4', { text: `${fieldLabel(config.property)} rollup` });
		renderRollup(this.containerEl, incomingRollup(this.sourcePath, this.ctx.index.items(), resolver(this.ctx), config));
	}
}

export function registerPanel(ctx: KitContext): void {
	ctx.plugin.registerView(RELATIONS_VIEW, (leaf) => new RelationsView(leaf, ctx));
	ctx.plugin.addCommand({ id: 'relations-open-panel', name: 'Open relations panel', callback: async () => {
		const leaf = ctx.app.workspace.getLeavesOfType(RELATIONS_VIEW)[0] ?? ctx.app.workspace.getRightLeaf(false);
		if (!leaf) { new Notice('No workspace pane is available.'); return; }
		await leaf.setViewState({ type: RELATIONS_VIEW, active: true });
		await ctx.app.workspace.revealLeaf(leaf);
	} });
	// `obtion-rollup` is the 0.1.0 name, kept so existing notes keep rendering.
	for (const language of ['notebase-rollup', 'obtion-rollup']) {
		ctx.plugin.registerMarkdownCodeBlockProcessor(language, (source: string, el: HTMLElement, context: MarkdownPostProcessorContext) => {
			context.addChild(new RollupBlock(el, ctx, source, context.sourcePath));
		});
	}
}
