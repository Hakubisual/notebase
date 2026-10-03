import { TFile, setIcon, type App } from 'obsidian';
import type { KitContext } from '../../core/context';
import { moveField, toggleField } from '../../core/fields';
import { parseProjectSections, summarizeProject } from '../../core/sections';
import { STATUS_BY_KIND } from '../../core/types';
import {
	buildCard,
	CARD_FIELD_LABELS,
	CARD_FIELDS,
	filterAndSort,
	parseBoardOptions,
	SORT_KEYS,
	SORT_LABELS,
	type BoardOptions,
	type ProjectCard,
	type SortKey,
} from './model';

export const FEATURE_ID = 'status-board';

export function loadOptions(ctx: KitContext): BoardOptions {
	return parseBoardOptions(ctx.featureData(FEATURE_ID));
}

export async function collectCards(ctx: KitContext): Promise<ProjectCard[]> {
	const all = ctx.index.items();
	const headings = ctx.settings().headings;
	const layout = loadOptions(ctx).layout;
	const cards: ProjectCard[] = [];
	for (const project of all.filter((i) => i.kind === 'project')) {
		const file = ctx.app.vault.getFileByPath(project.path);
		const summary = file instanceof TFile ? summarizeProject(parseProjectSections(await ctx.app.vault.cachedRead(file), headings)) : null;
		cards.push(buildCard(project, summary, all, layout));
	}
	return cards;
}

function openPath(app: App, path: string, newLeaf: boolean): void {
	void app.workspace.openLinkText(path, '', newLeaf);
}

function renderCard(app: App, parent: HTMLElement, card: ProjectCard): void {
	const el = parent.createDiv({ cls: 'obtion-status-board__card' });
	const head = el.createDiv({ cls: 'obtion-status-board__card-head' });
	const title = head.createEl('a', { cls: 'obtion-status-board__title', text: card.title, href: '#' });
	title.addEventListener('click', (evt) => {
		evt.preventDefault();
		openPath(app, card.path, evt.ctrlKey || evt.metaKey);
	});
	const status = card.status ?? 'no status';
	head.createSpan({ cls: `obtion-status-board__pill is-${card.knownStatus ? status : 'unknown'}`, text: status });
	head.createSpan({ cls: 'obtion-status-board__pct', text: card.progress === null ? '' : `${card.progress}%` });
	const bar = el.createDiv({ cls: 'obtion-status-board__bar', attr: { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' } });
	if (card.progress === null) {
		bar.addClass('is-empty');
		bar.setAttr('aria-label', 'No tasks recorded');
	} else {
		bar.setAttr('aria-valuenow', String(card.progress));
		bar.createDiv({ cls: 'obtion-status-board__bar-fill' }).style.setProperty('--obtion-progress', `${card.progress}%`);
	}
	if (card.rows.length > 0) {
		const grid = el.createDiv({ cls: 'obtion-status-board__rows' });
		for (const row of card.rows) {
			grid.createDiv({ cls: 'obtion-status-board__label', text: row.label });
			const value = grid.createDiv({ cls: 'obtion-status-board__value' });
			if (row.value === null) {
				value.addClass('is-unset');
				value.setText('Not set');
			} else {
				value.createSpan({ text: row.value });
			}
			for (const link of row.links) {
				const a = value.createEl('a', { cls: 'obtion-status-board__chip', text: link.title, href: '#' });
				a.addEventListener('click', (evt) => {
					evt.preventDefault();
					openPath(app, link.path, evt.ctrlKey || evt.metaKey);
				});
			}
		}
	}
	const foot = el.createDiv({ cls: 'obtion-status-board__foot' });
	const open = foot.createEl('a', { cls: 'obtion-status-board__open', href: '#' });
	setIcon(open.createSpan(), 'file-text');
	open.createSpan({ text: 'Open project note' });
	open.addEventListener('click', (evt) => {
		evt.preventDefault();
		openPath(app, card.path, evt.ctrlKey || evt.metaKey);
	});
}

export interface BoardRenderOptions {
	readonly compact: boolean;
	readonly onNewProject?: () => void;
	readonly onChange: () => void;
	readonly customizeOpen: boolean;
	readonly onToggleCustomize: (open: boolean) => void;
}

export async function renderBoard(ctx: KitContext, container: HTMLElement, opts: BoardRenderOptions): Promise<void> {
	const options = loadOptions(ctx);
	const cards = await collectCards(ctx);
	const visible = filterAndSort(cards, options);
	container.empty();
	container.addClass('obtion-status-board');
	container.toggleClass('is-compact', opts.compact);

	const bar = container.createDiv({ cls: 'obtion-status-board__toolbar' });
	if (!opts.compact) bar.createEl('h2', { cls: 'obtion-status-board__heading', text: 'Project status' });
	const actions = bar.createDiv({ cls: 'obtion-status-board__actions' });
	if (opts.onNewProject !== undefined) {
		const onNew = opts.onNewProject;
		const btn = actions.createEl('button', { cls: 'mod-cta', text: 'New project' });
		btn.addEventListener('click', () => onNew());
	}
	const customize = actions.createEl('button', { text: 'Customize', attr: { 'aria-expanded': String(opts.customizeOpen) } });
	actions.createSpan({ cls: 'obtion-status-board__count', text: `${visible.length} of ${cards.length} projects` });

	const panel = container.createDiv({ cls: 'obtion-status-board__customize' });
	panel.toggle(opts.customizeOpen);
	customize.addEventListener('click', () => {
		const open = !panel.isShown();
		panel.toggle(open);
		customize.setAttr('aria-expanded', String(open));
		opts.onToggleCustomize(open);
	});
	renderCustomize(ctx, panel, options, opts.onChange);

	const list = container.createDiv({ cls: 'obtion-status-board__list' });
	if (cards.length === 0) {
		const empty = list.createDiv({ cls: 'obtion-status-board__empty' });
		empty.createEl('p', { text: `No projects yet in "${ctx.settings().rootFolder}".` });
		empty.createEl('p', { cls: 'obtion-muted', text: 'Create one with the button above, or open the command palette and insert sample projects to explore.' });
		return;
	}
	if (visible.length === 0) {
		list.createDiv({ cls: 'obtion-status-board__empty', text: 'No projects match the current filter.' });
		return;
	}
	for (const card of visible) renderCard(ctx.app, list, card);
}

async function save(ctx: KitContext, next: BoardOptions, onChange: () => void): Promise<void> {
	await ctx.setFeatureData(FEATURE_ID, next);
	onChange();
}

function renderCustomize(ctx: KitContext, panel: HTMLElement, options: BoardOptions, onChange: () => void): void {
	const fields = panel.createDiv({ cls: 'obtion-status-board__section' });
	fields.createDiv({ cls: 'obtion-status-board__section-title', text: 'Fields (shown in this order)' });
	const ordered = [...options.layout.shown, ...CARD_FIELDS.filter((f) => !options.layout.shown.includes(f))];
	for (const field of ordered) {
		if (!(CARD_FIELDS as readonly string[]).includes(field)) continue;
		const shown = options.layout.shown.includes(field);
		const row = fields.createDiv({ cls: 'obtion-status-board__field-row' });
		const label = row.createEl('label');
		const box = label.createEl('input', { type: 'checkbox' });
		box.checked = shown;
		label.appendText(` ${CARD_FIELD_LABELS[field as keyof typeof CARD_FIELD_LABELS]}`);
		box.addEventListener('change', () => {
			void save(ctx, { ...options, layout: toggleField(options.layout, field, box.checked) }, onChange);
		});
		if (shown) {
			for (const [delta, icon, name] of [[-1, 'arrow-up', 'Move up'], [1, 'arrow-down', 'Move down']] as const) {
				const b = row.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': `${name}: ${field}` } });
				setIcon(b, icon);
				b.addEventListener('click', () => {
					void save(ctx, { ...options, layout: moveField(options.layout, field, delta) }, onChange);
				});
			}
		}
	}

	const filter = panel.createDiv({ cls: 'obtion-status-board__section' });
	filter.createDiv({ cls: 'obtion-status-board__section-title', text: 'Show projects with status' });
	for (const status of STATUS_BY_KIND.project) {
		const label = filter.createEl('label', { cls: 'obtion-status-board__check' });
		const box = label.createEl('input', { type: 'checkbox' });
		box.checked = options.statuses.length === 0 || options.statuses.includes(status);
		label.appendText(` ${status}`);
		box.addEventListener('change', () => {
			const base = options.statuses.length === 0 ? [...STATUS_BY_KIND.project] : [...options.statuses];
			const next = box.checked ? [...new Set([...base, status])] : base.filter((s) => s !== status);
			void save(ctx, { ...options, statuses: next }, onChange);
		});
	}

	const sort = panel.createDiv({ cls: 'obtion-status-board__section' });
	sort.createDiv({ cls: 'obtion-status-board__section-title', text: 'Sort by' });
	const select = sort.createEl('select', { cls: 'dropdown' });
	for (const key of SORT_KEYS) select.createEl('option', { value: key, text: SORT_LABELS[key] });
	select.value = options.sort;
	select.addEventListener('change', () => {
		const value = SORT_KEYS.find((k): k is SortKey => k === select.value) ?? 'name';
		void save(ctx, { ...options, sort: value }, onChange);
	});

	const reset = panel.createEl('button', { text: 'Reset to default' });
	reset.addEventListener('click', () => {
		void save(ctx, parseBoardOptions(null), onChange);
	});
}
