import type { KitFeature } from '../../core/context';
import { registerPanel } from './panel';
import { registerTemplates } from './template-ui';

export const relationsFeature: KitFeature = {
	id: 'relations',
	register(ctx) {
		registerPanel(ctx);
		registerTemplates(ctx);
	},
};
