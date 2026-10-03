import type { CreateNoteRequest } from '../../core/context';
import { checkKitNoteEdit } from '../../core/guards';
import { checkRootFolder, sanitizeFileName } from '../../core/paths';
import type { SectionHeadings } from '../../core/sections';
import { builtinTemplate, isoDate, renderTemplate, yamlString } from '../../core/templates';
import type { KitItem } from '../../core/types';

export type WikiCreation = { readonly ok: true; readonly request: CreateNoteRequest } | { readonly ok: false; readonly error: string };

/** Validate before producing any write request; the writer remains the final boundary. */
export function prepareWikiPage(root: string, title: string, parent: KitItem | null, headings: SectionHeadings, date: Date): WikiCreation {
	const rootCheck = checkRootFolder(root);
	if (!rootCheck.ok) return rootCheck;
	if (title.trim() === '') return { ok: false, error: 'Enter a page title.' };
	if (parent && (!checkKitNoteEdit(root, parent.path, parent.properties).ok || parent.kind !== 'wiki')) {
		return { ok: false, error: 'The parent is no longer a wiki page in the workspace folder.' };
	}
	const safeTitle = sanitizeFileName(title);
	return {
		ok: true,
		request: {
			folder: 'Wiki', title: safeTitle,
			content: renderTemplate(builtinTemplate('wiki', headings), {
				title: safeTitle, date: isoDate(date), parent: yamlString(parent ? `[[${parent.path}]]` : ''),
			}),
		},
	};
}
