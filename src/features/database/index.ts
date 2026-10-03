import { ItemView, MarkdownRenderChild, Notice, parseYaml, type WorkspaceLeaf } from 'obsidian';
import type { KitContext, KitFeature } from '../../core/context';
import { parseDbQuery, parseDbState, type DbQuery } from './query';
import { DatabaseRenderer } from './render';

const VIEW_TYPE = 'obtion-database';

class DatabaseView extends ItemView {
	constructor(leaf: WorkspaceLeaf, private readonly ctx: KitContext,
		private readonly attach: (renderer: DatabaseRenderer) => void) { super(leaf); }
	getViewType(): string { return VIEW_TYPE; }
	getDisplayText(): string { return 'Database'; }
	getIcon(): string { return 'table'; }
	onOpen(): Promise<void> {
		const renderer = new DatabaseRenderer(this.ctx, this.contentEl, parseDbState(this.ctx.featureData('database')).view,
			async (view) => {
				await this.ctx.setFeatureData('database', { ...parseDbState(this.ctx.featureData('database')), view });
			});
		this.attach(renderer);
		this.addChild(renderer);
		return Promise.resolve();
	}
}

export const databaseFeature: KitFeature = {
	id: 'database',
	register(ctx) {
		const renderers = new Set<DatabaseRenderer>();
		const attach = (renderer: DatabaseRenderer) => {
			renderers.add(renderer);
			renderer.register(() => renderers.delete(renderer));
		};
		ctx.plugin.register(() => {
			for (const renderer of renderers) renderer.unload();
			renderers.clear();
		});
		ctx.plugin.registerView(VIEW_TYPE, (leaf) => new DatabaseView(leaf, ctx, attach));
		ctx.plugin.addCommand({ id: 'database-open-view', name: 'Open database view', callback: () => {
			const open = async () => {
				const existing = ctx.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
				const leaf = existing ?? ctx.app.workspace.getLeaf('tab');
				if (!existing) await leaf.setViewState({ type: VIEW_TYPE, active: true });
				await ctx.app.workspace.revealLeaf(leaf);
			};
			void open().catch((error: unknown) => new Notice(error instanceof Error ? error.message : String(error)));
		} });
		// `obtion-db` is the 0.1.0 name, kept so existing notes keep rendering.
		for (const language of ['notebase-db', 'obtion-db']) ctx.plugin.registerMarkdownCodeBlockProcessor(language, (source, element, markdown) => {
			let query: DbQuery;
			try {
				const raw: unknown = source.trim() === '' ? {} : parseYaml(source);
				query = parseDbQuery(raw);
			} catch (error) {
				element.addClass('obtion-database');
				element.createEl('p', { text: `Database configuration: ${error instanceof Error ? error.message : String(error)}`, attr: { role: 'alert' } });
				return;
			}
			// Stable across note edits above the fence. Identical blocks in one note intentionally share preferences.
			const key = JSON.stringify([markdown.sourcePath, source]);
			const state = parseDbState(ctx.featureData('database'));
			const child = new MarkdownRenderChild(element);
			const renderer = new DatabaseRenderer(ctx, element, state.blocks[key] ?? query, async (next) => {
				const current = parseDbState(ctx.featureData('database'));
				await ctx.setFeatureData('database', { ...current, blocks: { ...current.blocks, [key]: next } });
			});
			attach(renderer);
			child.addChild(renderer);
			markdown.addChild(child);
		});
	},
};
