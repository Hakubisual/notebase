import type { CreateNoteRequest } from '../../core/context';
import { checkKitNoteEdit } from '../../core/guards';
import { checkRootFolder } from '../../core/paths';
import type { KitSettings } from '../../core/settings';
import { isKitKind, STATUS_BY_KIND } from '../../core/types';
import { canEditProperty, DbConfigError, newNoteContent, type DbQuery } from './query';

/** Called inside SafeWriter's mutation callback, checking the fresh frontmatter, not an index snapshot. */
export function editProperty(root: string, path: string, frontmatter: Record<string, unknown>, property: string, value: string): void {
	const check = checkKitNoteEdit(root, path, frontmatter);
	if (!check.ok) throw new DbConfigError('note', check.reason);
	if (!canEditProperty(property)) throw new DbConfigError('property', 'This property is read-only');
	const kind = frontmatter.kit;
	if (property === 'status') {
		if (!isKitKind(kind) || !STATUS_BY_KIND[kind].some((status) => status === value)) {
			throw new DbConfigError('status', 'Choose a valid status for this note');
		}
	} else if (frontmatter[property] !== undefined && frontmatter[property] !== null && typeof frontmatter[property] !== 'string') {
		throw new DbConfigError('property', 'Structured properties must be edited in the note');
	}
	frontmatter[property] = value;
}

export function newNoteRequest(query: DbQuery, title: string, date: string, settings: KitSettings): CreateNoteRequest {
	const root = checkRootFolder(settings.rootFolder);
	if (!root.ok) throw new DbConfigError('rootFolder', root.error);
	return { folder: '', title, content: newNoteContent(query, title, date, settings.headings) };
}
