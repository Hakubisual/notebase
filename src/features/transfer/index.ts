import type { KitFeature } from '../../core/context';
import { ExportModal, ImportModal } from './modals';
import type { TransferModal } from './modals';

export const transferFeature: KitFeature = {
	id: 'transfer',
	register(ctx) {
		const active = new Set<TransferModal>();
		ctx.plugin.register(() => { for (const modal of active) modal.close(); active.clear(); });
		ctx.plugin.addCommand({
			id: 'transfer-import-notion', name: 'Import an extracted Notion export',
			callback: () => {
				const modal = new ImportModal(ctx, () => active.delete(modal));
				active.add(modal); modal.open();
			},
		});
		ctx.plugin.addCommand({
			id: 'transfer-export', name: 'Export notes',
			callback: () => {
				const modal = new ExportModal(ctx, () => active.delete(modal));
				active.add(modal); modal.open();
			},
		});
	},
};
