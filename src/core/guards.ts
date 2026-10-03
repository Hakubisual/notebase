import { isInsideRoot } from './paths';
import { isKitKind, KIT_KEY } from './types';

export type EditCheck = { readonly ok: true } | { readonly ok: false; readonly reason: 'outside-root' | 'not-kit-note' };

/** Same opt-in rule as the index: inside the root folder and `kit` is a known kind. */
export function checkKitNoteEdit(root: string, path: string, frontmatter: unknown): EditCheck {
	if (!isInsideRoot(root, path)) return { ok: false, reason: 'outside-root' };
	if (typeof frontmatter !== 'object' || frontmatter === null || Array.isArray(frontmatter)) return { ok: false, reason: 'not-kit-note' };
	const kind: unknown = KIT_KEY in frontmatter ? frontmatter[KIT_KEY] : undefined;
	return isKitKind(kind) ? { ok: true } : { ok: false, reason: 'not-kit-note' };
}
