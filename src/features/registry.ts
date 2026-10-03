import type { KitFeature } from '../core/context';
import { statusBoardFeature } from './status-board';
import { wikiFeature } from './wiki';
import { databaseFeature } from './database';
import { relationsFeature } from './relations';
import { navigationFeature } from './navigation';
import { transferFeature } from './transfer';

export const FEATURES: readonly KitFeature[] = [
	statusBoardFeature,
	wikiFeature,
	databaseFeature,
	relationsFeature,
	navigationFeature,
	transferFeature,
];
