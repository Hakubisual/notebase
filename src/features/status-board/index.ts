import { getFrontMatterInfo, ItemView, MarkdownRenderChild, Modal, Notice, parseYaml, Setting, type App, type WorkspaceLeaf } from 'obsidian';
import type { KitContext, KitFeature } from '../../core/context';
import { builtinTemplate, isoDate, renderTemplate } from '../../core/templates';
import { parseLinkText } from '../../core/types';
import { FEATURE_ID, renderBoard } from './board';
import { SAMPLE_ITEMS, SAMPLE_PROJECTS } from './samples';

export const VIEW_TYPE = 'obtion-status-board';

const FOLDER_BY_KIND: Readonly<Record<'project' | 'task' | 'decision', string>> = {
	project: 'Projects',
	task: 'Tasks',
	decision: 'Decisions',
};

class StatusBoardView extends ItemView {
	private unsubscribe: (() => void) | null = null;
	private customizeOpen = false;
	private rendering = false;
	private queued = false;

	constructor(leaf: WorkspaceLeaf, private readonly ctx: KitContext) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Project status';
	}

	getIcon(): string {
		return 'layout-dashboard';
	}

	async onOpen(): Promise<void> {
		this.unsubscribe = this.ctx.index.onChange(() => void this.refresh());
		await this.refresh();
	}

	async onClose(): Promise<void> {
		this.unsubscribe?.();
		this.unsubscribe = null;
	}

	async refresh(): Promise<void> {
		if (this.rendering) {
			this.queued = true;
			return;
		}
		this.rendering = true;
		try {
			await renderBoard(this.ctx, this.contentEl, {
				compact: false,
				onNewProject: () => openCreateModal(this.ctx, 'project', null),
				onChange: () => void this.refresh(),
				customizeOpen: this.customizeOpen,
				onToggleCustomize: (open) => {
					this.customizeOpen = open;
				},
			});
		} finally {
			this.rendering = false;
			if (this.queued) {
				this.queued = false;
				void this.refresh();
			}
		}
	}
}

class InlineBoard extends MarkdownRenderChild {
	private unsubscribe: (() => void) | null = null;
	private customizeOpen = false;

	constructor(containerEl: HTMLElement, private readonly ctx: KitContext) {
		super(containerEl);
	}

	onload(): void {
		this.unsubscribe = this.ctx.index.onChange(() => void this.render());
		void this.render();
	}

	onunload(): void {
		this.unsubscribe?.();
	}

	private async render(): Promise<void> {
		await renderBoard(this.ctx, this.containerEl, {
			compact: true,
			onChange: () => void this.render(),
			customizeOpen: this.customizeOpen,
			onToggleCustomize: (open) => {
				this.customizeOpen = open;
			},
		});
	}
}

class CreateNoteModal extends Modal {
	private title = '';
	private project: string;

	constructor(app: App, private readonly ctx: KitContext, private readonly kind: 'project' | 'task' | 'decision', presetProject: string | null) {
		super(app);
		this.project = presetProject ?? '';
	}

	onOpen(): void {
		const { contentEl } = this;
		this.setTitle(`New ${this.kind}`);
		new Setting(contentEl).setName('Title').addText((text) => {
			text.setPlaceholder(this.kind === 'project' ? 'Garden planner' : 'Short, specific title');
			text.onChange((v) => {
				this.title = v;
			});
			text.inputEl.addEventListener('keydown', (evt) => {
				if (evt.key === 'Enter' && !evt.isComposing) {
					evt.preventDefault();
					void this.submit();
				}
			});
			window.setTimeout(() => text.inputEl.focus(), 0);
		});
		if (this.kind !== 'project') {
			const names = new Set(this.ctx.index.byKind('project').map((p) => p.basename));
			if (this.project !== '') names.add(this.project);
			const row = new Setting(contentEl).setName('Project');
			const select = row.controlEl.createEl('select', { cls: 'dropdown' });
			select.createEl('option', { value: '', text: 'None' });
			for (const name of [...names].sort((a, b) => a.localeCompare(b))) select.createEl('option', { value: name, text: name });
			select.value = this.project;
			select.addEventListener('change', () => {
				this.project = select.value;
			});
		}
		new Setting(contentEl).addButton((b) =>
			b
				.setButtonText('Create')
				.setCta()
				.onClick(() => void this.submit()),
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async submit(): Promise<void> {
		const title = this.title.trim();
		if (title === '') {
			new Notice('Enter a title first.');
			return;
		}
		const content = renderTemplate(builtinTemplate(this.kind, this.ctx.settings().headings), {
			title,
			date: isoDate(new Date()),
			project: this.project === '' ? '""' : `"[[${this.project}]]"`,
		});
		const file = await this.ctx.writer.createNote({ folder: FOLDER_BY_KIND[this.kind], title, content });
		this.close();
		await this.app.workspace.getLeaf(false).openFile(file);
	}
}

function openCreateModal(ctx: KitContext, kind: 'project' | 'task' | 'decision', presetProject: string | null): void {
	new CreateNoteModal(ctx.app, ctx, kind, presetProject).open();
}

async function activeProjectName(ctx: KitContext): Promise<string | null> {
	const file = ctx.app.workspace.getActiveFile();
	if (file === null || !ctx.writer.isInsideRoot(file.path)) return null;
	const item = ctx.index.get(file.path);
	if (item !== null) return item.kind === 'project' ? item.basename : item.projectLink;
	let fm: unknown = ctx.app.metadataCache.getFileCache(file)?.frontmatter;
	if (fm === undefined) {
		const info = getFrontMatterInfo(await ctx.app.vault.cachedRead(file));
		fm = info.exists ? parseYaml(info.frontmatter) : undefined;
	}
	if (typeof fm !== 'object' || fm === null) return null;
	const kit: unknown = 'kit' in fm ? fm.kit : undefined;
	if (kit === 'project') return file.basename;
	return parseLinkText('project' in fm ? fm.project : undefined);
}

async function activateView(ctx: KitContext): Promise<void> {
	const { workspace } = ctx.app;
	const existing = workspace.getLeavesOfType(VIEW_TYPE)[0];
	const leaf = existing ?? workspace.getRightLeaf(false);
	if (leaf === null) return;
	if (existing === undefined) await leaf.setViewState({ type: VIEW_TYPE, active: true });
	await workspace.revealLeaf(leaf);
}

async function insertSamples(ctx: KitContext): Promise<void> {
	let created = 0;
	const linkByTitle = new Map<string, string>();
	for (const sample of SAMPLE_PROJECTS) {
		const file = await ctx.writer.createNote({ folder: sample.folder, title: sample.title, content: sample.content });
		linkByTitle.set(sample.title, file.basename);
		created++;
	}
	for (const sample of SAMPLE_ITEMS) {
		const link = linkByTitle.get(sample.projectTitle) ?? sample.projectTitle;
		await ctx.writer.createNote({ folder: sample.folder, title: sample.title, content: sample.content(link) });
		created++;
	}
	new Notice(`Created ${created} sample notes in "${ctx.settings().rootFolder}/Samples". Existing files were not changed.`);
}

export const statusBoardFeature: KitFeature = {
	id: FEATURE_ID,
	register(ctx) {
		const { plugin } = ctx;
		plugin.registerView(VIEW_TYPE, (leaf) => new StatusBoardView(leaf, ctx));
		plugin.addRibbonIcon('layout-dashboard', 'Open project status', () => void activateView(ctx));
		plugin.addCommand({ id: 'status-board-open', name: 'Open project status board', callback: () => void activateView(ctx) });
		plugin.addCommand({ id: 'status-board-new-project', name: 'Create project', callback: () => openCreateModal(ctx, 'project', null) });
		const kinds: readonly ['task' | 'decision', string][] = [
			['task', 'Create task'],
			['decision', 'Create decision'],
		];
		for (const [kind, name] of kinds) {
			plugin.addCommand({
				id: `status-board-new-${kind}`,
				name,
				callback: () => {
					void activeProjectName(ctx).then((project) => openCreateModal(ctx, kind, project));
				},
			});
		}
		plugin.addCommand({ id: 'status-board-insert-samples', name: 'Insert sample projects', callback: () => void insertSamples(ctx) });
		plugin.registerMarkdownCodeBlockProcessor('obtion-status', (_source, el, mdCtx) => {
			mdCtx.addChild(new InlineBoard(el, ctx));
		});
	},
};
