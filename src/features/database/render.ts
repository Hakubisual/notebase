import { Component, Modal, Notice, Setting, TFile } from 'obsidian';
import type { KitContext } from '../../core/context';
import { displayValue, FIELD_LABELS, isInternalField, moveField, STANDARD_FIELDS, toggleField } from '../../core/fields';
import { isoDate } from '../../core/templates';
import { KIT_KINDS, parseLinkText, STATUS_BY_KIND, type KitItem } from '../../core/types';
import { applyQuery, canEditProperty, groupItems, itemValue, parseDbQuery, queryWithFields, type DbQuery } from './query';
import { editProperty, newNoteRequest } from './writes';

function label(field: string): string {
	const standard = STANDARD_FIELDS.find((name) => name === field);
	return standard === undefined ? field : FIELD_LABELS[standard];
}

function report(error: unknown): void {
	new Notice(error instanceof Error ? error.message : String(error));
}

/** Each render has its own Component, so removed controls do not retain event handlers. */
export class DatabaseRenderer extends Component {
	private controls: Component | null = null;
	private customizeOpen = false;
	private readonly modals = new Set<Modal>();
	constructor(private readonly ctx: KitContext, private readonly container: HTMLElement,
		private query: DbQuery, private readonly save: (query: DbQuery) => Promise<void>) { super(); }

	onload(): void {
		this.register(this.ctx.index.onChange(() => this.render()));
		this.register(() => this.container.empty());
		this.register(() => {
			for (const modal of this.modals) modal.close();
			this.modals.clear();
		});
		this.render();
	}

	private openModal(modal: Modal): void {
		this.modals.add(modal);
		modal.open();
	}

	private async change(query: DbQuery): Promise<void> {
		await this.save(query);
		this.query = query;
		this.render();
	}

	private button(parent: HTMLElement, text: string, action: () => void | Promise<void>): HTMLButtonElement {
		const button = parent.createEl('button', { text, attr: { type: 'button' } });
		this.controls?.registerDomEvent(button, 'click', () => {
			button.disabled = true;
			Promise.resolve().then(action).catch(report).finally(() => { button.disabled = false; });
		});
		return button;
	}

	private select(parent: HTMLElement, title: string, options: readonly string[], current: string,
		action: (value: string) => Promise<void>, labels?: Readonly<Record<string, string>>, hideLabel = false): HTMLSelectElement {
		const wrapper = parent.createEl('label', { cls: 'obtion-database-control' });
		wrapper.createSpan({ text: title, cls: hideLabel ? 'obtion-database-sr' : '' });
		const select = wrapper.createEl('select', { attr: { 'aria-label': title } });
		for (const value of options) select.createEl('option', { value, text: labels?.[value] ?? value });
		select.value = current;
		this.controls?.registerDomEvent(select, 'change', () => {
			select.disabled = true;
			void action(select.value).catch((error: unknown) => { select.value = current; report(error); })
				.finally(() => { select.disabled = false; });
		});
		return select;
	}

	private render(): void {
		if (this.controls !== null) this.removeChild(this.controls);
		this.controls = this.addChild(new Component());
		const root = this.container;
		root.empty();
		root.addClass('obtion-database');
		const query = this.query;
		const rows = applyQuery(this.ctx.index.items(), query);
		const toolbar = root.createDiv({ cls: 'obtion-database-toolbar' });
		this.select(toolbar, 'Kind', KIT_KINDS, query.kind, (kind) => this.change(parseDbQuery({ ...query, kind })));
		this.select(toolbar, 'Layout', ['table', 'board', 'gallery'], query.layout,
			(layout) => this.change(parseDbQuery({ ...query, layout })));
		this.button(toolbar, 'New', () => { this.openModal(new NewRowModal(this.ctx, query)); });
		root.createEl('p', { cls: 'obtion-database-muted', text: `${rows.length} ${rows.length === 1 ? 'note' : 'notes'}` });
		this.customize(root);
		if (rows.length === 0) root.createEl('p', { text: 'No notes match. Change the filters or create a note.' });
		switch (query.layout) {
			case 'table': this.table(root, rows); break;
			case 'board': this.board(root, rows); break;
			case 'gallery': {
				const gallery = root.createDiv({ cls: 'obtion-database-gallery' });
				for (const row of rows) this.card(gallery, row, true);
				break;
			}
			default: { const unreachable: never = query.layout; throw new Error(String(unreachable)); }
		}
	}

	private customize(root: HTMLElement): void {
		const query = this.query;
		const details = root.createEl('details', { cls: 'obtion-database-customize' });
		details.open = this.customizeOpen;
		details.createEl('summary', { text: 'Customize' });
		this.controls?.registerDomEvent(details, 'toggle', () => { this.customizeOpen = details.open; });
		const tools = details.createDiv({ cls: 'obtion-database-toolbar' });
		this.button(tools, `Filters (${query.filter.length})`, () => { this.openModal(new QueryOptionsModal(this.ctx, query, (q) => this.change(q))); });
		const fields = [...new Set([...query.columns, query.groupBy, ...query.sort.map((sort) => sort.property), ...(query.cover ? [query.cover] : []), ...STANDARD_FIELDS,
			...this.ctx.index.byKind(query.kind).flatMap((item) => Object.keys(item.properties))])]
			.filter((field) => field !== 'name' && field !== 'position' && !['__proto__', 'constructor', 'prototype'].includes(field));
		const sort = query.sort[0];
		this.select(tools, 'Sort by', ['', 'name', ...fields], sort?.property ?? '',
			(property) => this.change({ ...query, sort: property ? [{ property, direction: sort?.direction ?? 'asc' }] : [] }), { '': 'Name (default)' });
		this.select(tools, 'Direction', ['asc', 'desc'], sort?.direction ?? 'asc',
			(direction) => this.change(parseDbQuery({ ...query, sort: [{ property: sort?.property ?? 'name', direction }] })),
			{ asc: 'Ascending', desc: 'Descending' });
		if (query.sort.length > 1) tools.createEl('p', { text: 'Changing sort replaces all configured sort rules.', cls: 'obtion-database-muted' });
		if (query.layout === 'board') this.select(tools, 'Group by', fields, query.groupBy,
			(groupBy) => this.change({ ...query, groupBy }));
		if (query.layout === 'gallery') this.select(tools, 'Cover property', ['', ...fields], query.cover ?? '',
			(cover) => this.change({ ...query, cover: cover || null }), { '': 'No cover' });
		details.createEl('p', { text: 'Shown fields, in order. Internal fields are opt-in.', cls: 'obtion-database-muted' });
		const picker = details.createDiv({ cls: 'obtion-database-fields' });
		for (const field of fields) {
			const row = picker.createDiv({ cls: 'obtion-database-field' });
			const wrapper = row.createEl('label');
			const checkbox = wrapper.createEl('input', { type: 'checkbox' });
			checkbox.checked = query.columns.includes(field);
			wrapper.createSpan({ text: `${label(field)}${isInternalField(field) ? ' (internal)' : ''}` });
			this.controls?.registerDomEvent(checkbox, 'change', () => {
				void this.change(queryWithFields(query, toggleField({ shown: query.columns }, field, checkbox.checked))).catch(report);
			});
			if (!checkbox.checked) continue;
			const up = this.button(row, 'Up', () => this.change(queryWithFields(query, moveField({ shown: query.columns }, field, -1))));
			up.setAttribute('aria-label', `Move ${label(field)} up`);
			up.disabled = query.columns.indexOf(field) === 0;
			const down = this.button(row, 'Down', () => this.change(queryWithFields(query, moveField({ shown: query.columns }, field, 1))));
			down.setAttribute('aria-label', `Move ${label(field)} down`);
			down.disabled = query.columns.indexOf(field) === query.columns.length - 1;
		}
	}

	private title(parent: HTMLElement, item: KitItem): void {
		const button = this.button(parent, item.basename, () => this.ctx.app.workspace.openLinkText(item.path, '', false));
		button.addClass('obtion-database-note');
	}

	private async update(item: KitItem, property: string, value: string): Promise<void> {
		const current = this.ctx.index.get(item.path);
		const file = this.ctx.app.vault.getAbstractFileByPath(item.path);
		if (!current || !(file instanceof TFile) || !canEditProperty(property)) throw new Error('This property is no longer editable.');
		if (property === 'status' && !STATUS_BY_KIND[current.kind].some((status) => status === value)) {
			throw new Error('Choose a valid status.');
		}
		await this.ctx.writer.updateFrontmatter(file, (fm) => {
			editProperty(this.ctx.settings().rootFolder, file.path, fm, property, value);
		});
	}

	private status(parent: HTMLElement, item: KitItem): void {
		const statuses: readonly string[] = STATUS_BY_KIND[item.kind];
		const current = item.status ?? '';
		const options = statuses.includes(current) ? statuses : [current, ...statuses];
		const select = this.select(parent, `Status for ${item.basename}`, options, current,
			(value) => this.update(item, 'status', value), { '': 'Not set' }, true);
		if (!statuses.includes(current)) select.options.item(0)?.setAttribute('disabled', '');
	}

	private property(parent: HTMLElement, item: KitItem, field: string, editable: boolean): void {
		if (field === 'status' && editable) { this.status(parent, item); return; }
		const value = itemValue(item, field);
		const link = typeof value === 'string' && /^\[\[[^\]]+\]\]$/.test(value.trim()) ? parseLinkText(value) : null;
		if (link !== null) {
			const a = parent.createEl('a', { cls: 'internal-link', text: link, href: '#' });
			this.controls?.registerDomEvent(a, 'click', (evt) => {
				evt.preventDefault();
				void this.ctx.app.workspace.openLinkText(link, item.path, evt.ctrlKey || evt.metaKey);
			});
			return;
		}
		if (editable && canEditProperty(field) && (value === undefined || value === null || typeof value === 'string')) {
			const input = parent.createEl('input', { type: 'text', value: typeof value === 'string' ? value : '',
				attr: { 'aria-label': `${label(field)} for ${item.basename}`, placeholder: 'Not set' } });
			this.controls?.registerDomEvent(input, 'change', () => {
				input.disabled = true;
				void this.update(item, field, input.value).catch((error: unknown) => { input.value = typeof value === 'string' ? value : ''; report(error); })
					.finally(() => { input.disabled = false; });
			});
		} else {
			const text = displayValue(value);
			parent.createSpan({ text: text ?? (value !== null && typeof value === 'object' ? 'Structured value (open note)' : 'Not set'),
				cls: text === null ? 'obtion-database-muted' : '' });
		}
	}

	private table(root: HTMLElement, rows: readonly KitItem[]): void {
		const wrapper = root.createDiv({ cls: 'obtion-database-table-scroll', attr: { tabindex: '0', 'aria-label': 'Database table' } });
		const table = wrapper.createEl('table');
		const head = table.createEl('thead').createEl('tr');
		for (const column of ['name', ...this.query.columns]) head.createEl('th', { text: column === 'name' ? 'Name' : label(column), attr: { scope: 'col' } });
		const body = table.createEl('tbody');
		for (const item of rows) {
			const row = body.createEl('tr');
			this.title(row.createEl('td'), item);
			for (const field of this.query.columns) this.property(row.createEl('td'), item, field, true);
		}
	}

	private card(parent: HTMLElement, item: KitItem, gallery: boolean): HTMLElement {
		const card = parent.createDiv({ cls: 'obtion-database-card' });
		if (gallery && this.query.cover) {
			const raw = itemValue(item, this.query.cover);
			const link = parseLinkText(typeof raw === 'string' && raw.startsWith('!') ? raw.slice(1) : raw);
			if (link && !/^[a-z][a-z\d+.-]*:/i.test(link) && !link.startsWith('//')) {
				const file = this.ctx.app.metadataCache.getFirstLinkpathDest(link, item.path);
				if (file && /^(png|jpe?g|gif|webp|avif|bmp)$/i.test(file.extension)) {
					card.createEl('img', { cls: 'obtion-database-cover', attr: { src: this.ctx.app.vault.getResourcePath(file), alt: '', loading: 'lazy' } });
				}
			}
		}
		this.title(card, item);
		for (const field of this.query.columns) {
			if (!gallery && field === 'status') continue;
			const line = card.createDiv({ cls: 'obtion-database-property' });
			line.createSpan({ text: label(field), cls: 'obtion-database-muted' });
			this.property(line, item, field, false);
		}
		if (!gallery) this.status(card, item);
		return card;
	}

	private board(root: HTMLElement, rows: readonly KitItem[]): void {
		const board = root.createDiv({ cls: 'obtion-database-board' });
		for (const group of groupItems(rows, this.query)) {
			const column = board.createDiv({ cls: 'obtion-database-column' });
			column.createEl('h3', { text: `${group.value ?? 'Not set'} (${group.items.length})` });
			const value = group.value;
			const acceptsDrop = this.query.groupBy === 'status' && value !== null && STATUS_BY_KIND[this.query.kind].some((status) => status === value);
			if (acceptsDrop) {
				this.controls?.registerDomEvent(column, 'dragover', (event) => { event.preventDefault(); });
				this.controls?.registerDomEvent(column, 'drop', (event) => {
					event.preventDefault();
					const path = event.dataTransfer?.getData('application/x-obtion-database');
					const item = rows.find((row) => row.path === path);
					if (item && value !== null) void this.update(item, 'status', value).catch(report);
				});
			}
			for (const item of group.items) {
				const card = this.card(column, item, false);
				card.draggable = this.query.groupBy === 'status';
				this.controls?.registerDomEvent(card, 'dragstart', (event) => {
					event.dataTransfer?.setData('application/x-obtion-database', item.path);
				});
			}
		}
	}
}

class NewRowModal extends Modal {
	constructor(private readonly ctx: KitContext, private readonly query: DbQuery) { super(ctx.app); }
	onOpen(): void {
		this.contentEl.addClass('obtion-database');
		this.titleEl.setText('New database note');
		let title = '';
		new Setting(this.contentEl).setName('Name').addText((text) => text.onChange((value) => { title = value; }));
		this.contentEl.createEl('p', { text: 'Equality filters are prefilled. Other filters may hide the new note.', cls: 'obtion-database-muted' });
		new Setting(this.contentEl).addButton((button) => button.setButtonText('Create').setCta().onClick(async () => {
			if (!title.trim() || /[\r\n]/.test(title)) { new Notice('Enter a name on one line.'); return; }
			button.setDisabled(true);
			try {
				const request = newNoteRequest(this.query, title.trim(), isoDate(new Date()), this.ctx.settings());
				const file = await this.ctx.writer.createNote(request);
				this.close();
				await this.ctx.app.workspace.getLeaf(false).openFile(file);
			} catch (error) { report(error); button.setDisabled(false); }
		}));
	}
	onClose(): void { this.contentEl.empty(); }
}

class QueryOptionsModal extends Modal {
	constructor(ctx: KitContext, private readonly query: DbQuery, private readonly save: (query: DbQuery) => Promise<void>) { super(ctx.app); }
	onOpen(): void {
		this.contentEl.addClass('obtion-database');
		this.titleEl.setText('Filter notes');
		this.contentEl.createEl('p', { text: 'All filters must match. Values are text or JSON scalars; in uses a JSON list. Contains is case-sensitive.' });
		const drafts = this.query.filter.map((filter) => ({ property: filter.property, op: String(filter.op),
			value: 'value' in filter ? JSON.stringify(filter.value) : '' }));
		const rows = this.contentEl.createDiv();
		const render = () => {
			rows.empty();
			for (const draft of drafts) {
				const row = rows.createDiv({ cls: 'obtion-database-filter' });
				new Setting(row).setName('Property').addText((text) => text.setValue(draft.property).onChange((value) => { draft.property = value; }));
				new Setting(row).setName('Condition').addDropdown((drop) => drop.addOptions({ equals: 'Equals', in: 'In', contains: 'Contains', empty: 'Is empty' })
					.setValue(draft.op).onChange((value) => { draft.op = value; render(); }));
				if (draft.op !== 'empty') new Setting(row).setName('Value').addText((text) => text.setValue(draft.value).onChange((value) => { draft.value = value; }));
				new Setting(row).addButton((button) => button.setButtonText('Remove filter').onClick(() => { drafts.splice(drafts.indexOf(draft), 1); render(); }));
			}
		};
		render();
		new Setting(this.contentEl).addButton((button) => button.setButtonText('Add filter').onClick(() => { drafts.push({ property: 'status', op: 'equals', value: 'todo' }); render(); }))
			.addButton((button) => button.setButtonText('Apply').setCta().onClick(async () => {
				button.setDisabled(true);
				try {
					const filter = drafts.map((draft) => {
						if (draft.op === 'empty') return { property: draft.property, op: draft.op };
						let value: unknown = draft.value;
						try { value = JSON.parse(draft.value); }
						catch (error) { if (!(error instanceof SyntaxError)) throw error; }
						return { property: draft.property, op: draft.op, value };
					});
					await this.save(parseDbQuery({ ...this.query, filter }));
					this.close();
				} catch (error) { report(error); button.setDisabled(false); }
			}));
	}
	onClose(): void { this.contentEl.empty(); }
}
