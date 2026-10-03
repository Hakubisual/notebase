// Pure path helpers. Every write the plugin performs goes through these guards.

/** Same contract as Obsidian's normalizePath for the cases we need, kept pure for tests. */
export function cleanPath(input: string): string {
	return input
		.replace(/\u00A0/g, ' ')
		.replace(/[\\/]+/g, '/')
		.replace(/^\/+|\/+$/g, '')
		.normalize();
}

export type RootCheck = { readonly ok: true; readonly root: string } | { readonly ok: false; readonly error: string };

/** The kit always works inside one named folder. The whole vault, dot segments and hidden folders are rejected. */
export function checkRootFolder(input: string): RootCheck {
	const root = cleanPath(input.trim());
	if (root === '') return { ok: false, error: 'Choose a folder inside the vault. The whole vault cannot be the workspace folder.' };
	const parts = root.split('/');
	if (parts.some((part) => part.trim() === '')) return { ok: false, error: 'Folder names cannot be blank.' };
	if (parts.some((part) => part === '..' || part === '.')) return { ok: false, error: 'The folder path cannot contain "." or "..".' };
	if (parts.some((part) => part.startsWith('.'))) return { ok: false, error: 'Hidden folders (starting with ".") cannot be the workspace folder.' };
	return { ok: true, root };
}

/** True when `path` is the root folder itself or lies under it. An invalid root contains nothing. */
export function isInsideRoot(root: string, path: string): boolean {
	const check = checkRootFolder(root);
	if (!check.ok) return false;
	const p = cleanPath(path);
	if (p.split('/').some((part) => part === '..' || part === '.')) return false;
	return p === check.root || p.startsWith(check.root + '/');
}

export function joinPath(...parts: readonly string[]): string {
	return cleanPath(parts.filter((part) => part.trim() !== '').join('/'));
}

const FORBIDDEN = /[\\/:*?"<>|#^[\]]/g;

/** Make a user-supplied title safe as a file name (no extension). Never returns an empty string. */
export function sanitizeFileName(title: string): string {
	const cleaned = title.replace(FORBIDDEN, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
	return cleaned.length > 0 ? cleaned.slice(0, 120) : 'Untitled';
}

/**
 * First free path "<folder>/<name>.<ext>", then "<name> 2", "<name> 3", ...
 * `exists` is asked for every candidate, so existing files are never chosen (never overwritten).
 */
export function uniquePath(folder: string, name: string, ext: string, exists: (path: string) => boolean): string {
	const base = sanitizeFileName(name);
	for (let n = 1; n < 10_000; n++) {
		const candidate = joinPath(folder, `${n === 1 ? base : `${base} ${n}`}.${ext}`);
		if (!exists(candidate)) return candidate;
	}
	throw new PathExhaustedError(folder, base);
}

export class PathExhaustedError extends Error {
	constructor(readonly folder: string, readonly base: string) {
		super(`No free file name for "${base}" in "${folder}"`);
		this.name = 'PathExhaustedError';
	}
}
