# Architecture

Obtion is a single Obsidian plugin made of a small core and six independent features. Everything runs locally
through the Obsidian API; there is no network code.

## Data model

A note joins Obtion when its frontmatter has `kit: <kind>` with a known kind **and** it lives inside the workspace folder
(setting, default `Obtion`). Nothing else is read, edited or deleted.

| kind | default status | statuses | typical properties |
|---|---|---|---|
| project | active | active, paused, done, dropped | owner, due, created |
| task | todo | todo, doing, blocked, done, dropped | project, owner, due, priority, verified |
| decision | open | open, decided, superseded | project, decided |
| wiki | draft | draft, published, archived | parent |
| record | active | active, archived | project (generic row, e.g. imported) |

Relations are frontmatter properties whose value is a wikilink or a list of wikilinks, such as
`project: "[[Garden planner]]"` or `parent: "[[Handbook]]"`.

A project note has four sections with configurable headings: Principle, To do, Done, Verification limits.

## Core (`src/core`)

| module | role |
|---|---|
| `types.ts` | kinds, statuses, `parseKitItem` (frontmatter -> item) |
| `paths.ts` | path cleaning, `checkRootFolder` (one named folder; no whole vault, `..` or hidden folders), `uniquePath` (never overwrite) |
| `guards.ts` | `checkKitNoteEdit`: the same opt-in rule the index uses, applied to every frontmatter write |
| `index-service.ts` | event-driven index of opted-in notes (metadata cache events, debounced) |
| `writer.ts` | `SafeWriter`: creates files only inside the workspace folder, uniquified names; edits frontmatter only of opted-in notes |
| `fields.ts` | human field catalogue, internal-field detection, layout helpers (show/hide/order) |
| `sections.ts` | parser for the four project sections and the progress summary |
| `settings.ts` | settings parser with validation and a user-visible error for an invalid stored folder |
| `templates.ts` | built-in templates and `{{variable}}` rendering |

Features talk to the core only through `KitContext` (`src/core/context.ts`): the index, the safe writer, settings,
per-feature saved preferences and settings sections. Features never import each other.

## Features (`src/features`)

| folder | user-facing parts | identifiers |
|---|---|---|
| `status-board` | project cards, create project/task/decision, sample data | view `obtion-status-board`, block `obtion-status` |
| `wiki` | wiki pages, sub-pages, page tree | view `obtion-wiki-tree`, blocks `obtion-children`, `obtion-breadcrumb` |
| `database` | table / board / gallery, inline edits | view `obtion-database`, block `obtion-db` |
| `relations` | templates folder, new note from template, relations panel, rollups | view `obtion-relations`, block `obtion-rollup` |
| `navigation` | quick find with query syntax, go to project, next open task, recent | modals only |
| `transfer` | import an extracted Notion export, CSV/Markdown export | modals only |

Each feature keeps its user preferences under its own key in the plugin's `data.json` and parses them at load time,
so a damaged value falls back to defaults instead of failing.

## Styles

`styles/*.css` are concatenated into `styles.css` at build time. Every selector is scoped under `.obtion-<feature>`
and uses Obsidian CSS variables only.

## Tests

`bun test` runs deterministic unit tests for the pure modules (no timers, network or clock). UI behavior is checked
manually in a disposable vault; see `docs/FEATURE-MATRIX.md`.
