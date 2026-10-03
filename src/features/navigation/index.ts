import type { Modal } from 'obsidian';
import type { KitFeature } from '../../core/context';
import { FindModal, openItem } from './modal';
import { activeProject, nextOpenTask } from './query';

export const navigationFeature: KitFeature = {
	id: 'navigation',
	register(ctx) {
		const modals = new Set<Modal>();
		ctx.plugin.register(() => {
			const active = [...modals];
			modals.clear();
			for (const modal of active) modal.close();
		});
		const find = () => new FindModal(ctx, modals, {}).open();
		const activePath = () => ctx.app.workspace.getActiveFile()?.path ?? null;
		ctx.plugin.addCommand({ id: 'navigation-find', name: 'Find note', callback: find });
		ctx.plugin.addRibbonIcon('search', 'Find note', find);
		ctx.plugin.addCommand({
			id: 'navigation-recent', name: 'Recent notes',
			callback: () => new FindModal(ctx, modals, { recent: true }).open(),
		});
		ctx.plugin.addCommand({
			id: 'navigation-go-to-project', name: 'Go to project',
			checkCallback: (checking) => {
				const item = ctx.index.get(activePath() ?? '');
				const project = item?.projectPath ? ctx.index.get(item.projectPath) : null;
				if (!project || project.kind !== 'project') return false;
				if (!checking) void openItem(ctx, project);
				return true;
			},
		});
		ctx.plugin.addCommand({
			id: 'navigation-find-in-project', name: 'Find in project',
			checkCallback: (checking) => {
				const project = activeProject(ctx.index.items(), activePath());
				if (!project) return false;
				if (!checking) new FindModal(ctx, modals, { projectPath: project.path }).open();
				return true;
			},
		});
		ctx.plugin.addCommand({
			id: 'navigation-next-open-task', name: 'Next open task',
			checkCallback: (checking) => {
				const path = activePath();
				const item = ctx.index.get(path ?? '');
				if (!item || (item.kind !== 'project' && item.kind !== 'task')) return false;
				const project = activeProject(ctx.index.items(), path);
				const next = project ? nextOpenTask(ctx.index.items(), project.path, path) : null;
				if (!next) return false;
				if (!checking) void openItem(ctx, next);
				return true;
			},
		});
	},
};
