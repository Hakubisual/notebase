import { normalizePath, TFile, TFolder, type App } from 'obsidian';
import type { CreateNoteRequest, SafeWriter } from './context';
import { checkKitNoteEdit } from './guards';
import { KIT_KEY } from './types';
import { isInsideRoot, joinPath, uniquePath } from './paths';

export class OutsideRootError extends Error {
	constructor(readonly path: string, readonly root: string) {
		super(`Refusing to write "${path}": it is outside the workspace folder "${root}".`);
		this.name = 'OutsideRootError';
	}
}

export class NotKitNoteError extends Error {
	constructor(readonly path: string) {
		super(`Refusing to edit "${path}": its "${KIT_KEY}" property is missing or not a known kind.`);
		this.name = 'NotKitNoteError';
	}
}

export class VaultSafeWriter implements SafeWriter {
	constructor(private readonly app: App, private readonly root: () => string) {}

	isInsideRoot(path: string): boolean {
		return isInsideRoot(this.root(), path);
	}

	async createNote(request: CreateNoteRequest): Promise<TFile> {
		const root = this.root();
		const folder = normalizePath(joinPath(root, request.folder));
		if (!isInsideRoot(root, folder)) throw new OutsideRootError(folder, root);
		await this.ensureFolder(folder);
		const vault = this.app.vault;
		const path = uniquePath(folder, request.title, request.extension ?? 'md', (p) => vault.getAbstractFileByPath(normalizePath(p)) !== null);
		return vault.create(normalizePath(path), request.content);
	}

	async updateFrontmatter(file: TFile, mutate: (frontmatter: Record<string, unknown>) => void): Promise<void> {
		const root = this.root();
		const check = checkKitNoteEdit(root, file.path, this.app.metadataCache.getFileCache(file)?.frontmatter);
		if (!check.ok) {
			if (check.reason === 'outside-root') throw new OutsideRootError(file.path, root);
			throw new NotKitNoteError(file.path);
		}
		await this.app.fileManager.processFrontMatter(file, mutate);
	}

	private async ensureFolder(folder: string): Promise<void> {
		if (folder === '') return;
		const parts = folder.split('/');
		for (let i = 1; i <= parts.length; i++) {
			const path = parts.slice(0, i).join('/');
			const existing = this.app.vault.getAbstractFileByPath(path);
			if (existing instanceof TFolder) continue;
			if (existing instanceof TFile) throw new OutsideRootError(path, folder);
			await this.app.vault.createFolder(path);
		}
	}
}
