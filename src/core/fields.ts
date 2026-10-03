// Human-facing field catalogue shared by every view. Pure module.

export const STANDARD_FIELDS = ['next', 'due', 'owner', 'status', 'priority', 'project', 'decision', 'related', 'verified'] as const;
export type StandardField = (typeof STANDARD_FIELDS)[number];

export const FIELD_LABELS: Readonly<Record<StandardField, string>> = {
	next: 'Next action',
	due: 'Due',
	owner: 'Owner',
	status: 'Status',
	priority: 'Priority',
	project: 'Project',
	decision: 'Decision',
	related: 'Related notes',
	verified: 'Verified',
};

// Machine/agent bookkeeping that people should not see unless they opt in through a field picker.
const INTERNAL_FIELD = /^(kit|session|session[-_]?id|token|tokens|model|agent|ai|ai[-_].*|log|logs|prompt|cost|pane|discord|thread|run[-_]?id|cssclasses|position)$/i;

export function isInternalField(name: string): boolean {
	return INTERNAL_FIELD.test(name.trim());
}

/** Default shown properties: everything except internal bookkeeping fields. */
export function visibleByDefault(names: readonly string[]): string[] {
	return names.filter((n) => !isInternalField(n));
}

/** A value that is absent must render as "not set", never as a made-up owner, date or completion. */
export function displayValue(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	if (typeof value === 'string') return value.trim() === '' ? null : value.trim();
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	if (Array.isArray(value)) {
		const parts = value.map(displayValue).filter((v): v is string => v !== null);
		return parts.length > 0 ? parts.join(', ') : null;
	}
	return null;
}

export interface FieldLayout {
	/** Ordered list of shown fields; anything not listed is hidden. */
	readonly shown: readonly string[];
}

export function moveField(layout: FieldLayout, field: string, delta: -1 | 1): FieldLayout {
	const shown = [...layout.shown];
	const i = shown.indexOf(field);
	const j = i + delta;
	if (i < 0 || j < 0 || j >= shown.length) return layout;
	const a = shown[i];
	const b = shown[j];
	if (a === undefined || b === undefined) return layout;
	shown[i] = b;
	shown[j] = a;
	return { shown };
}

export function toggleField(layout: FieldLayout, field: string, on: boolean): FieldLayout {
	const without = layout.shown.filter((f) => f !== field);
	return { shown: on ? [...without, field] : without };
}

/** Boundary parser for persisted layouts. Unknown junk falls back to `fallback`. */
export function parseFieldLayout(raw: unknown, fallback: FieldLayout): FieldLayout {
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return fallback;
	const shown: unknown = 'shown' in raw ? raw.shown : undefined;
	if (!Array.isArray(shown)) return fallback;
	const clean = shown.filter((v): v is string => typeof v === 'string' && v.trim() !== '');
	return { shown: [...new Set(clean)] };
}
