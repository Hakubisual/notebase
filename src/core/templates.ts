import type { SectionHeadings } from './sections';
import { STATUS_BY_KIND, type KitKind } from './types';

export type TemplateVars = Readonly<Record<string, string>>;

/** Replace {{name}} placeholders. Unknown placeholders are left as-is so users can see them. */
export function renderTemplate(template: string, vars: TemplateVars): string {
	return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, key: string) => vars[key] ?? match);
}

export function isoDate(date: Date): string {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, '0');
	const d = String(date.getDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
}

/** YAML-safe double-quoted scalar. */
export function yamlString(value: string): string {
	return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function frontmatterBlock(entries: Readonly<Record<string, string>>): string {
	const lines = Object.entries(entries).map(([k, v]) => `${k}: ${v}`);
	return ['---', ...lines, '---', ''].join('\n');
}

export function builtinTemplate(kind: KitKind, headings: SectionHeadings): string {
	const status = STATUS_BY_KIND[kind][0];
	switch (kind) {
		case 'project':
			return [
				frontmatterBlock({ kit: 'project', status, created: '{{date}}' }),
				`## ${headings.principle}`,
				'- How this project works, in one or two lines.',
				'',
				`## ${headings.todo}`,
				'- [ ] First next action',
				'',
				`## ${headings.done}`,
				'',
				`## ${headings.limits}`,
				'- What has not been verified yet, and why.',
				'',
			].join('\n');
		case 'task':
			return [
				frontmatterBlock({ kit: 'task', status, project: '{{project}}', due: '""', created: '{{date}}' }),
				'## Goal',
				'',
				'## Log',
				'- {{date}} · created',
				'',
				'## Evidence',
				'',
			].join('\n');
		case 'decision':
			return [
				frontmatterBlock({ kit: 'decision', status, project: '{{project}}', decided: '""', created: '{{date}}' }),
				'## Question',
				'',
				'## Options',
				'- A:',
				'- B:',
				'',
				'## Decision',
				'',
				'## Why',
				'',
			].join('\n');
		case 'wiki':
			return [frontmatterBlock({ kit: 'wiki', status, parent: '{{parent}}', created: '{{date}}' }), ''].join('\n');
		case 'record':
			return [frontmatterBlock({ kit: 'record', status, project: '{{project}}', created: '{{date}}' }), ''].join('\n');
		default: {
			const unreachable: never = kind;
			throw new Error(`Unknown kind ${String(unreachable)}`);
		}
	}
}
