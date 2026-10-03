import { ItemView, MarkdownRenderChild, Modal, Notice, Setting } from 'obsidian';
import type { WorkspaceLeaf } from 'obsidian';
import type { KitContext } from '../../core/context';
import { isInternalField, moveField, STANDARD_FIELDS, toggleField } from '../../core/fields';
import { prepareWikiPage } from './creation';
import { breadcrumb, buildWikiTree, descendants, parseDepth } from './hierarchy';
import type { WikiNode, WikiTree } from './hierarchy';
import { fieldLabel, fieldValue, parseWikiData, sortedNodes, visiblePaths } from './preferences';
import type { WikiData, WikiPreferences } from './preferences';

export const WIKI_VIEW = 'obtion-wiki-tree';

/** One host subscription per feature, not one per render or code block. */
export class WikiRuntime {
	private readonly listeners = new Set<() => void>();
	private saving = false;
	constructor(readonly ctx: KitContext) {
		ctx.plugin.register(ctx.index.onChange(() => this.refresh()));
		ctx.plugin.registerEvent(ctx.app.workspace.on('active-leaf-change', () => this.refresh()));
		ctx.plugin.registerEvent(ctx.app.workspace.on('file-open', () => this.refresh()));
		ctx.plugin.register(() => this.listeners.clear());
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	refresh(): void {
		for (const listener of this.listeners) listener();
	}

	tree(): WikiTree {
		return buildWikiTree(this.ctx.index.byKind('wiki'), (link, source) =>
			this.ctx.app.metadataCache.getFirstLinkpathDest(link, source)?.path ?? null);
	}

	preferences(surface: keyof WikiData): WikiPreferences {
		return parseWikiData(this.ctx.featureData('wiki'))[surface];
	}

	async save(surface: keyof WikiData, preferences: WikiPreferences): Promise<void> {
		if (this.saving) {
			new Notice('Wiki preferences are still saving. Try again when saving finishes.');
			return;
		}
		this.saving = true;
		try {
			await this.ctx.setFeatureData('wiki', { ...parseWikiData(this.ctx.featureData('wiki')), [surface]: preferences });
			this.refresh();
		} catch (error) {
			new Notice(`Could not save wiki preferences: ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			this.saving = false;
		}
	}

	async open(path: string, source = '', newLeaf = false): Promise<void> {
		try {
			await this.ctx.app.workspace.openLinkText(path, source, newLeaf);
		} catch (error) {
			new Notice(`Could not open wiki page: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
}

export class WikiCreateModal extends Modal {
	constructor(private readonly runtime: WikiRuntime, private readonly parentPath: string | null) {
		super(runtime.ctx.app);
	}

	onOpen(): void {
		this.contentEl.addClass('obtion-wiki');
		new Setting(this.contentEl).setName(this.parentPath ? 'Create wiki subpage' : 'Create wiki page').setHeading();
		let title = '';
		let saving = false;
		let submit: (() => void) | null = null;
		new Setting(this.contentEl).setName('Title').addText((text) => {
			text.setPlaceholder('Page title').onChange((value) => { title = value; });
			text.inputEl.addEventListener('keydown', (evt) => {
				if (evt.key !== 'Enter' || evt.isComposing) return;
				evt.preventDefault();
				submit?.();
			});
			text.inputEl.focus();
		});
		new Setting(this.contentEl).addButton((button) => {
			submit = () => button.buttonEl.click();
			return button.setButtonText('Create page').setCta().onClick(async () => {
			if (saving) return;
			if (title.trim() === '') {
				new Notice('Enter a page title.');
				return;
			}
			const { ctx } = this.runtime;
			const parent = this.parentPath ? ctx.index.get(this.parentPath) : null;
			if (this.parentPath && !parent) {
				new Notice('The parent page is no longer available.');
				return;
			}
			const settings = ctx.settings();
			const prepared = prepareWikiPage(settings.rootFolder, title, parent, settings.headings, new Date());
			if (!prepared.ok) {
				new Notice(prepared.error);
				return;
			}
			saving = true;
			button.setDisabled(true);
			try {
				const file = await ctx.writer.createNote(prepared.request);
				this.close();
				await this.runtime.open(file.path);
			} catch (error) {
				new Notice(`Could not create wiki page: ${error instanceof Error ? error.message : String(error)}`);
			} finally {
				saving = false;
				button.setDisabled(false);
			}
		});
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

function pageLink(container: HTMLElement, node: WikiNode, runtime: WikiRuntime, source: string): void {
	const link = container.createEl('a', { text: node.item.basename, cls: 'internal-link', href: node.item.path });
	link.setAttribute('data-href', node.item.path);
	if (runtime.ctx.app.workspace.getActiveFile()?.path === node.item.path) {
		link.addClass('obtion-wiki-active');
		link.setAttribute('aria-current', 'page');
	}
	link.addEventListener('click', (event) => {
		event.preventDefault();
		void runtime.open(node.item.path, source, event.ctrlKey || event.metaKey);
	});
}

export class WikiPanel extends MarkdownRenderChild {
	private customizeOpen = false;
	constructor(container: HTMLElement, private readonly runtime: WikiRuntime,
		private readonly surface: 'tree' | 'children' | 'breadcrumb', private readonly sourcePath = '', private readonly source = '') {
		super(container);
	}

	onload(): void {
		this.register(this.runtime.subscribe(() => this.render()));
		this.render();
	}

	private controls(container: HTMLElement, nodes: readonly WikiNode[], preferences: WikiPreferences, surface: keyof WikiData): void {
		const details = container.createEl('details', { cls: 'obtion-wiki-customize' });
		details.open = this.customizeOpen;
		details.createEl('summary', { text: 'Customize' });
		details.addEventListener('toggle', () => { this.customizeOpen = details.open; });
		const save = (next: WikiPreferences) => this.runtime.save(surface, next);
		new Setting(details).setName('Status filter').addDropdown((dropdown) => {
			dropdown.addOption('', 'All statuses');
			const statuses = new Set(nodes.map((node) => node.item.status).filter((status): status is string => status !== null && status !== ''));
			if (preferences.status) statuses.add(preferences.status);
			for (const status of [...statuses].sort()) dropdown.addOption(status, status);
			dropdown.setValue(preferences.status).onChange((status) => save({ ...preferences, status }));
		});
		new Setting(details).setName('Sort by title').addDropdown((dropdown) => dropdown
			.addOption('ascending', 'Ascending').addOption('descending', 'Descending').setValue(preferences.sort)
			.onChange((value) => save({ ...preferences, sort: value === 'descending' ? 'descending' : 'ascending' })));
		details.createEl('p', { text: surface === 'children' ? 'Applies to all child-page blocks. Depth is set in each block.' : 'Choose the fields shown below each page.', cls: 'obtion-wiki-muted' });
		const available = [...new Set([...preferences.layout.shown, ...STANDARD_FIELDS, ...nodes.flatMap((node) => Object.keys(node.item.properties))])];
		for (const field of available) {
			const row = details.createDiv({ cls: 'obtion-wiki-field-control' });
			const label = row.createEl('label');
			const input = label.createEl('input', { type: 'checkbox' });
			input.checked = preferences.layout.shown.includes(field);
			label.createSpan({ text: `${fieldLabel(field)}${isInternalField(field) ? ' (internal)' : ''}` });
			input.addEventListener('change', () => { void save({ ...preferences, layout: toggleField(preferences.layout, field, input.checked) }); });
			if (input.checked) {
				for (const delta of [-1, 1] as const) {
					const button = row.createEl('button', { text: delta === -1 ? 'Up' : 'Down', attr: { type: 'button', 'aria-label': `Move ${fieldLabel(field)} ${delta === -1 ? 'up' : 'down'}` } });
					const position = preferences.layout.shown.indexOf(field);
					button.disabled = delta === -1 ? position === 0 : position === preferences.layout.shown.length - 1;
					button.addEventListener('click', () => { void save({ ...preferences, layout: moveField(preferences.layout, field, delta) }); });
				}
			}
		}
	}

	private render(): void {
		const container = this.containerEl;
		container.empty();
		container.addClass('obtion-wiki');
		const tree = this.runtime.tree();
		if (this.surface === 'breadcrumb') {
			const nav = container.createEl('nav', { attr: { 'aria-label': 'Wiki ancestors' }, cls: 'obtion-wiki-breadcrumb' });
			const ancestors = breadcrumb(tree, this.sourcePath);
			for (const node of ancestors) {
				if (nav.childElementCount > 0) nav.createSpan({ text: ' / ', attr: { 'aria-hidden': 'true' } });
				pageLink(nav, node, this.runtime, this.sourcePath);
			}
			if (ancestors.length === 0) nav.createSpan({ text: tree.nodes.has(this.sourcePath) ? 'Top-level wiki page' : 'This note is not an indexed wiki page.', cls: 'obtion-wiki-muted' });
			return;
		}
		const surface = this.surface;
		const preferences = this.runtime.preferences(surface);
		const depth = parseDepth(this.source);
		if (surface === 'children' && depth === null) {
			container.createEl('p', { text: 'Use depth: 1 through depth: 20, or leave the block empty.', cls: 'obtion-wiki-muted' });
			return;
		}
		const nodes = surface === 'tree' ? [...tree.nodes.values()] : descendants(tree, this.sourcePath, depth ?? 1);
		if (surface === 'tree') container.createEl('h2', { text: 'Wiki pages' });
		this.controls(container, nodes, preferences, surface);
		const issues = tree.issues.filter((issue) => nodes.some((node) => node.item.path === issue.path));
		if (issues.length > 0) {
			const details = container.createEl('details', { cls: 'obtion-wiki-issues' });
			details.createEl('summary', { text: `${issues.length} hierarchy issues` });
			for (const issue of issues) details.createEl('p', { text: `${issue.kind}: ${issue.path}` });
		}
		const visible = visiblePaths(nodes, preferences.status);
		if (visible.size === 0) {
			container.createEl('p', { text: preferences.status ? 'No pages match this status.' : surface === 'tree' ? 'No wiki pages yet. Use Create wiki page to begin.' : 'No child pages at this depth.', cls: 'obtion-wiki-muted' });
			return;
		}
		const list = container.createEl('ul', { cls: 'obtion-wiki-list' });
		const allowed = new Set(nodes.map((node) => node.item.path));
		const roots = surface === 'tree' ? tree.roots : tree.nodes.get(this.sourcePath)?.children ?? [];
		const pending = sortedNodes(roots, preferences.sort).reverse().map((node) => ({ node, list, level: 0 }));
		while (pending.length > 0) {
			const entry = pending.pop();
			if (!entry || !visible.has(entry.node.item.path)) continue;
			const { node } = entry;
			const li = entry.list.createEl('li');
			const row = li.createDiv({ cls: 'obtion-wiki-row' });
			const children = sortedNodes(node.children, preferences.sort).filter((child) => allowed.has(child.item.path) && visible.has(child.item.path));
			const collapsed = preferences.collapsed.includes(node.item.path);
			if (children.length > 0) {
				const button = row.createEl('button', { text: collapsed ? '+' : '-', attr: { type: 'button', 'aria-expanded': String(!collapsed), 'aria-label': `${collapsed ? 'Expand' : 'Collapse'} ${node.item.basename}` } });
				button.addEventListener('click', () => {
					void this.runtime.save(surface, { ...preferences, collapsed: collapsed ? preferences.collapsed.filter((path) => path !== node.item.path) : [...preferences.collapsed, node.item.path] });
				});
			}
			pageLink(row, node, this.runtime, this.sourcePath);
			const fields = li.createEl('dl', { cls: 'obtion-wiki-fields' });
			for (const field of preferences.layout.shown) {
				fields.createEl('dt', { text: fieldLabel(field) });
				const value = fieldValue(node.item, field);
				fields.createEl('dd', { text: value ?? 'Not set', cls: value === null ? 'obtion-wiki-muted' : '' });
			}
			if (children.length > 0 && !collapsed) {
				const nested = li.createEl('ul', { cls: entry.level < 5 ? 'obtion-wiki-list obtion-wiki-nested' : 'obtion-wiki-list' });
				for (const child of children.reverse()) pending.push({ node: child, list: nested, level: entry.level + 1 });
			}
		}
	}
}

export class WikiTreeView extends ItemView {
	private panel: WikiPanel | null = null;
	constructor(leaf: WorkspaceLeaf, private readonly runtime: WikiRuntime) { super(leaf); }
	getViewType(): string { return WIKI_VIEW; }
	getDisplayText(): string { return 'Wiki pages'; }
	getIcon(): string { return 'book-open'; }
	onOpen(): Promise<void> {
		this.panel = this.addChild(new WikiPanel(this.contentEl, this.runtime, 'tree'));
		return Promise.resolve();
	}
	onClose(): Promise<void> {
		if (this.panel) this.removeChild(this.panel);
		this.panel = null;
		this.contentEl.empty();
		return Promise.resolve();
	}
}
