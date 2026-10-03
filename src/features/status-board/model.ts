import { displayValue, parseFieldLayout, type FieldLayout } from '../../core/fields';
import type { ProjectSummary } from '../../core/sections';
import { STATUS_BY_KIND, type KitItem } from '../../core/types';

export const CARD_FIELDS = ['next', 'due', 'owner', 'principle', 'done', 'limits', 'decisions', 'related'] as const;
export type CardField = (typeof CARD_FIELDS)[number];

export const CARD_FIELD_LABELS: Readonly<Record<CardField, string>> = {
	next: 'Next action',
	due: 'Due',
	owner: 'Owner',
	principle: 'Principle',
	done: 'Done',
	limits: 'Verification limits',
	decisions: 'Decisions',
	related: 'Related notes',
};

export const SORT_KEYS = ['name', 'progress', 'due', 'updated'] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export const SORT_LABELS: Readonly<Record<SortKey, string>> = {
	name: 'Name',
	progress: 'Progress',
	due: 'Due date',
	updated: 'Last updated',
};

export interface BoardOptions {
	readonly layout: FieldLayout;
	/** Project statuses to show; empty means all. */
	readonly statuses: readonly string[];
	readonly sort: SortKey;
}

export const DEFAULT_BOARD_OPTIONS: BoardOptions = {
	layout: { shown: ['next', 'due', 'owner', 'principle', 'done', 'limits', 'decisions'] },
	statuses: ['active', 'paused'],
	sort: 'name',
};

function isCardField(value: string): value is CardField {
	return (CARD_FIELDS as readonly string[]).includes(value);
}

function isSortKey(value: unknown): value is SortKey {
	return typeof value === 'string' && (SORT_KEYS as readonly string[]).includes(value);
}

export function parseBoardOptions(raw: unknown): BoardOptions {
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return DEFAULT_BOARD_OPTIONS;
	const layoutRaw: unknown = 'layout' in raw ? raw.layout : undefined;
	const statusesRaw: unknown = 'statuses' in raw ? raw.statuses : undefined;
	const sortRaw: unknown = 'sort' in raw ? raw.sort : undefined;
	const layout = parseFieldLayout(layoutRaw, DEFAULT_BOARD_OPTIONS.layout);
	return {
		layout: { shown: layout.shown.filter(isCardField) },
		statuses: Array.isArray(statusesRaw) ? statusesRaw.filter((s): s is string => typeof s === 'string') : DEFAULT_BOARD_OPTIONS.statuses,
		sort: isSortKey(sortRaw) ? sortRaw : DEFAULT_BOARD_OPTIONS.sort,
	};
}

export interface CardRow {
	readonly field: CardField;
	readonly label: string;
	/** null = nothing recorded; the view shows "Not set" instead of inventing a value. */
	readonly value: string | null;
	readonly links: readonly { readonly path: string; readonly title: string }[];
}

export interface ProjectCard {
	readonly path: string;
	readonly title: string;
	readonly status: string | null;
	readonly knownStatus: boolean;
	readonly progress: number | null;
	readonly due: string | null;
	readonly mtime: number;
	readonly rows: readonly CardRow[];
}

const CLOSED = new Set(['done', 'dropped', 'superseded', 'archived']);

export function buildCard(project: KitItem, summary: ProjectSummary | null, all: readonly KitItem[], layout: FieldLayout): ProjectCard {
	const linked = all.filter((i) => i.path !== project.path && i.projectPath === project.path);
	const decisions = linked.filter((i) => i.kind === 'decision');
	const openDecisions = decisions.filter((d) => !CLOSED.has(d.status ?? '') && d.status !== 'decided');
	const related = linked.filter((i) => i.kind !== 'decision');
	const due = displayValue(project.properties.due);
	const owner = displayValue(project.properties.owner);
	const doneLabel = summary === null || summary.doneCount === 0 ? null : `${summary.doneCount} · ${summary.latestDone ?? ''}`.replace(/ · $/, '');
	const value: Record<CardField, string | null> = {
		next: summary?.nextTodo ?? null,
		due,
		owner,
		principle: summary?.principle ?? null,
		done: doneLabel,
		limits: summary?.limit ?? null,
		decisions: decisions.length === 0 ? null : `${openDecisions.length} open of ${decisions.length}`,
		related: related.length === 0 ? null : `${related.length}`,
	};
	const links: Partial<Record<CardField, KitItem[]>> = {
		decisions: openDecisions.length > 0 ? openDecisions : decisions,
		related,
	};
	const rows = layout.shown.filter(isCardField).map((field) => ({
		field,
		label: field === 'next' && summary !== null ? `${CARD_FIELD_LABELS.next} (${summary.openCount} open)` : CARD_FIELD_LABELS[field],
		value: value[field],
		links: (links[field] ?? []).slice(0, 3).map((i) => ({ path: i.path, title: i.basename })),
	}));
	const status = project.status;
	return {
		path: project.path,
		title: project.basename,
		status,
		knownStatus: status !== null && (STATUS_BY_KIND.project as readonly string[]).includes(status),
		progress: summary?.progress ?? null,
		due,
		mtime: project.mtime,
		rows,
	};
}

export function filterAndSort(cards: readonly ProjectCard[], options: BoardOptions): ProjectCard[] {
	const wanted = new Set(options.statuses);
	const kept = cards.filter((c) => wanted.size === 0 || wanted.has(c.status ?? ''));
	const byName = (a: ProjectCard, b: ProjectCard) => a.title.localeCompare(b.title);
	const sorted = [...kept];
	switch (options.sort) {
		case 'name':
			sorted.sort(byName);
			break;
		case 'progress':
			sorted.sort((a, b) => (b.progress ?? -1) - (a.progress ?? -1) || byName(a, b));
			break;
		case 'due':
			sorted.sort((a, b) => (a.due ?? '\uffff').localeCompare(b.due ?? '\uffff') || byName(a, b));
			break;
		case 'updated':
			sorted.sort((a, b) => b.mtime - a.mtime || byName(a, b));
			break;
		default: {
			const unreachable: never = options.sort;
			throw new Error(`Unknown sort ${String(unreachable)}`);
		}
	}
	return sorted;
}
