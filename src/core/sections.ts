// Pure parser for the four status sections of a project note.

export interface SectionHeadings {
	readonly principle: string;
	readonly todo: string;
	readonly done: string;
	readonly limits: string;
}

export interface ListEntry {
	readonly text: string;
	/** true for "- [x]", false for "- [ ]", null for a plain bullet or paragraph line. */
	readonly checked: boolean | null;
}

export interface ProjectSections {
	readonly principle: readonly ListEntry[];
	readonly todo: readonly ListEntry[];
	readonly done: readonly ListEntry[];
	readonly limits: readonly ListEntry[];
}

export interface ProjectSummary {
	readonly principle: string | null;
	readonly nextTodo: string | null;
	readonly latestDone: string | null;
	readonly limit: string | null;
	readonly openCount: number;
	readonly doneCount: number;
	/** 0..100, or null when there is nothing to count. */
	readonly progress: number | null;
}

type SectionKey = keyof ProjectSections;

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const ENTRY = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/;

function normalizeHeading(text: string): string {
	// Ignore leading emoji/symbols and case so "## ✅ Done" matches "Done".
	return text.replace(/^[^\p{L}\p{N}]+/u, '').trim().toLowerCase();
}

function stripFrontmatter(markdown: string): string {
	if (!markdown.startsWith('---')) return markdown;
	const end = markdown.indexOf('\n---', 3);
	if (end < 0) return markdown;
	const after = markdown.indexOf('\n', end + 4);
	return after < 0 ? '' : markdown.slice(after + 1);
}

export function parseProjectSections(markdown: string, headings: SectionHeadings): ProjectSections {
	const wanted = new Map<string, SectionKey>([
		[normalizeHeading(headings.principle), 'principle'],
		[normalizeHeading(headings.todo), 'todo'],
		[normalizeHeading(headings.done), 'done'],
		[normalizeHeading(headings.limits), 'limits'],
	]);
	const out: Record<SectionKey, ListEntry[]> = { principle: [], todo: [], done: [], limits: [] };
	let current: SectionKey | null = null;
	let currentLevel = 0;
	let inFence = false;

	for (const line of stripFrontmatter(markdown).split(/\r?\n/)) {
		if (/^\s*(```|~~~)/.test(line)) {
			inFence = !inFence;
			continue;
		}
		if (inFence) continue;
		const h = HEADING.exec(line);
		if (h) {
			const level = (h[1] ?? '').length;
			const key = wanted.get(normalizeHeading(h[2] ?? ''));
			if (key !== undefined) {
				current = key;
				currentLevel = level;
			} else if (current !== null && level <= currentLevel) {
				current = null;
			}
			continue;
		}
		if (current === null) continue;
		const trimmed = line.trim();
		if (trimmed === '' || trimmed.startsWith('>') || trimmed.startsWith('%%')) continue;
		const e = ENTRY.exec(line);
		if (e) {
			const mark = e[1];
			const text = (e[2] ?? '').trim();
			if (text === '') continue;
			out[current].push({ text, checked: mark === undefined ? null : mark !== ' ' });
		} else {
			out[current].push({ text: trimmed, checked: null });
		}
	}
	return out;
}

export function summarizeProject(sections: ProjectSections): ProjectSummary {
	const open = sections.todo.filter((e) => e.checked !== true);
	const doneInTodo = sections.todo.filter((e) => e.checked === true);
	const doneCount = sections.done.length + doneInTodo.length;
	const total = open.length + doneCount;
	return {
		principle: sections.principle[0]?.text ?? null,
		nextTodo: open[0]?.text ?? null,
		latestDone: sections.done[0]?.text ?? doneInTodo[0]?.text ?? null,
		limit: sections.limits[0]?.text ?? null,
		openCount: open.length,
		doneCount,
		progress: total === 0 ? null : Math.round((doneCount / total) * 100),
	};
}
