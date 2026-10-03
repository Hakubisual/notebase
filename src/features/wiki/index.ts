import type { KitFeature } from '../../core/context';
import { Notice } from 'obsidian';
import { WIKI_VIEW, WikiCreateModal, WikiPanel, WikiRuntime, WikiTreeView } from './ui';

export const wikiFeature: KitFeature = {
	id: 'wiki',
	register(ctx) {
		const runtime = new WikiRuntime(ctx);
		ctx.plugin.registerView(WIKI_VIEW, (leaf) => new WikiTreeView(leaf, runtime));
		ctx.plugin.addCommand({ id: 'wiki-create-page', name: 'Create wiki page', callback: () => new WikiCreateModal(runtime, null).open() });
		ctx.plugin.addCommand({
			id: 'wiki-create-subpage', name: 'Create wiki subpage',
			checkCallback: (checking) => {
				const file = ctx.app.workspace.getActiveFile();
				if (!file || ctx.index.get(file.path)?.kind !== 'wiki' || !ctx.writer.isInsideRoot(file.path)) return false;
				if (!checking) new WikiCreateModal(runtime, file.path).open();
				return true;
			},
		});
		ctx.plugin.addCommand({
			id: 'wiki-open-tree', name: 'Open wiki pages',
			callback: async () => {
				try {
					const leaf = ctx.app.workspace.getLeavesOfType(WIKI_VIEW)[0] ?? ctx.app.workspace.getRightLeaf(false);
					if (!leaf) { new Notice('No sidebar is available for wiki pages.'); return; }
					await leaf.setViewState({ type: WIKI_VIEW, active: true });
					await ctx.app.workspace.revealLeaf(leaf);
				} catch (error) {
					new Notice(`Could not open wiki pages: ${error instanceof Error ? error.message : String(error)}`);
				}
			},
		});
		ctx.plugin.registerMarkdownCodeBlockProcessor('obtion-children', (source, el, context) => {
			context.addChild(new WikiPanel(el, runtime, 'children', context.sourcePath, source));
		});
		ctx.plugin.registerMarkdownCodeBlockProcessor('obtion-breadcrumb', (_source, el, context) => {
			context.addChild(new WikiPanel(el, runtime, 'breadcrumb', context.sourcePath));
		});
	},
};
