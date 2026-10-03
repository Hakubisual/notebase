import { TFile, type App, type Plugin } from 'obsidian';
import type { KitIndex } from './context';
import { isInsideRoot } from './paths';
import { parseKitItem, type KitItem, type KitKind } from './types';

export class VaultKitIndex implements KitIndex {
	private cache: readonly KitItem[] | null = null;
	private readonly listeners = new Set<() => void>();
	private pending: number | null = null;

	constructor(private readonly app: App, private readonly root: () => string) {}

	attach(plugin: Plugin): void {
		const touch = (file: unknown) => {
			if (file instanceof TFile && file.extension === 'md') this.invalidate();
		};
		plugin.registerEvent(this.app.metadataCache.on('changed', touch));
		plugin.registerEvent(this.app.metadataCache.on('resolved', () => this.invalidate()));
		plugin.registerEvent(this.app.vault.on('delete', touch));
		plugin.registerEvent(this.app.vault.on('rename', touch));
		plugin.register(() => {
			if (this.pending !== null) window.clearTimeout(this.pending);
			this.listeners.clear();
		});
	}

	invalidate(): void {
		this.cache = null;
		if (this.pending !== null) return;
		this.pending = window.setTimeout(() => {
			this.pending = null;
			for (const listener of [...this.listeners]) listener();
		}, 150);
	}

	items(): readonly KitItem[] {
		if (this.cache !== null) return this.cache;
		const root = this.root();
		const resolve = (link: string, source: string) => this.app.metadataCache.getFirstLinkpathDest(link, source)?.path ?? null;
		const out: KitItem[] = [];
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (!isInsideRoot(root, file.path)) continue;
			const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
			if (fm === undefined) continue;
			const item = parseKitItem({ path: file.path, basename: file.basename, mtime: file.stat.mtime, frontmatter: fm }, resolve);
			if (item !== null) out.push(item);
		}
		out.sort((a, b) => a.basename.localeCompare(b.basename));
		this.cache = out;
		return out;
	}

	byKind(kind: KitKind): readonly KitItem[] {
		return this.items().filter((item) => item.kind === kind);
	}

	get(path: string): KitItem | null {
		return this.items().find((item) => item.path === path) ?? null;
	}

	onChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
}
