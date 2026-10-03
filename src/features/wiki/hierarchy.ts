import type { KitItem } from '../../core/types';
import { parseLinkText } from '../../core/types';

export interface WikiNode {
	readonly item: KitItem;
	parent: WikiNode | null;
	readonly children: WikiNode[];
}

export interface WikiIssue {
	readonly path: string;
	readonly kind: 'orphan' | 'ambiguous' | 'invalid' | 'cycle';
}

export interface WikiTree {
	readonly roots: readonly WikiNode[];
	readonly nodes: ReadonlyMap<string, WikiNode>;
	readonly issues: readonly WikiIssue[];
}

export function compareText(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

export function compareNodes(a: WikiNode, b: WikiNode): number {
	return compareText(a.item.basename.toLowerCase(), b.item.basename.toLowerCase()) || compareText(a.item.path, b.item.path);
}

/** When supplied, the host resolver is authoritative; only indexed wiki targets qualify. */
export function buildWikiTree(items: readonly KitItem[], resolve?: (link: string, source: string) => string | null): WikiTree {
	const ordered = items.filter((item) => item.kind === 'wiki').slice().sort((a, b) => compareText(a.path, b.path));
	const nodes = new Map<string, WikiNode>();
	const issues: WikiIssue[] = [];
	for (const item of ordered) nodes.set(item.path, { item, parent: null, children: [] });
	for (const node of nodes.values()) {
		const raw = node.item.properties.parent;
		if (raw === undefined || raw === null || raw === '') continue;
		const value: unknown = Array.isArray(raw) && raw.length === 1 ? raw[0] : raw;
		const link = parseLinkText(value);
		if (link === null) {
			issues.push({ path: node.item.path, kind: 'invalid' });
			continue;
		}
		if (resolve) {
			const path = resolve(link, node.item.path);
			node.parent = path === null ? null : nodes.get(path) ?? null;
			if (!node.parent) issues.push({ path: node.item.path, kind: 'orphan' });
			continue;
		}
		const target = link.replace(/\.md$/i, '');
		const exact = nodes.get(`${target}.md`);
		const folder = node.item.path.slice(0, node.item.path.lastIndexOf('/') + 1);
		const relative = nodes.get(`${folder}${target}.md`);
		if (exact || relative) {
			node.parent = exact ?? relative ?? null;
			continue;
		}
		const matches = [...nodes.values()].filter((candidate) => candidate.item.path.replace(/\.md$/i, '').endsWith(`/${target}`));
		if (matches.length === 1) node.parent = matches[0] ?? null;
		else issues.push({ path: node.item.path, kind: matches.length === 0 ? 'orphan' : 'ambiguous' });
	}
	// Each node has at most one parent. Cut the smallest path in each cycle,
	// preserving every page and reporting every affected cycle member.
	const visited = new Set<string>();
	for (const start of nodes.values()) {
		const trail: WikiNode[] = [];
		const positions = new Map<string, number>();
		let current: WikiNode | null = start;
		while (current && !visited.has(current.item.path)) {
			const position = positions.get(current.item.path);
			if (position !== undefined) {
				const cycle = trail.slice(position).sort((a, b) => compareText(a.item.path, b.item.path));
				for (const member of cycle) issues.push({ path: member.item.path, kind: 'cycle' });
				const first = cycle[0];
				if (first) first.parent = null;
				break;
			}
			positions.set(current.item.path, trail.length);
			trail.push(current);
			current = current.parent;
		}
		for (const member of trail) visited.add(member.item.path);
	}
	const roots: WikiNode[] = [];
	for (const node of nodes.values()) {
		if (node.parent) node.parent.children.push(node);
		else roots.push(node);
	}
	roots.sort(compareNodes);
	for (const node of nodes.values()) node.children.sort(compareNodes);
	issues.sort((a, b) => compareText(a.path, b.path) || compareText(a.kind, b.kind));
	return { roots, nodes, issues };
}

/** Ancestors ordered from root to immediate parent, excluding the current page. */
export function breadcrumb(tree: WikiTree, path: string): readonly WikiNode[] {
	const ancestors: WikiNode[] = [];
	let node = tree.nodes.get(path)?.parent;
	while (node) {
		ancestors.push(node);
		node = node.parent;
	}
	return ancestors.reverse();
}

/** Direct children are depth 1. Iterative traversal is safe for deeply nested vaults. */
export function descendants(tree: WikiTree, path: string, depth: number): readonly WikiNode[] {
	const result: WikiNode[] = [];
	const pending = [...(tree.nodes.get(path)?.children ?? [])].reverse().map((node) => ({ node, level: 1 }));
	while (pending.length > 0) {
		const entry = pending.pop();
		if (!entry || entry.level > depth) continue;
		result.push(entry.node);
		for (const child of [...entry.node.children].reverse()) pending.push({ node: child, level: entry.level + 1 });
	}
	return result;
}

export function parseDepth(source: string): number | null {
	if (source.trim() === '') return 1;
	const match = /^\s*depth:\s*(\d+)\s*$/.exec(source);
	if (!match?.[1]) return null;
	const depth = Number(match[1]);
	return depth >= 1 && depth <= 20 ? depth : null;
}
