# Features and limits (0.1.0)

**Implemented** means the feature ships and was exercised in Obsidian 1.13 in a disposable test vault.
Unit tests: `bun test` (pure logic, deterministic).

## Core and safety

| feature | status | notes |
|---|---|---|
| Opt-in notes (`kit: <kind>`) inside one workspace folder | implemented | Reads and writes use the same rule |
| Folder validation (no whole vault, `..`, hidden folders) | implemented | Invalid input shows an error and is not saved |
| Never overwrite on create | implemented | Existing names get a numeric suffix |
| No network, telemetry or secrets | implemented | |
| Settings searchable in Obsidian 1.13+, classic tab for older apps | implemented | minAppVersion 1.7.2 |
| Install, restart, disable, uninstall leave notes untouched | implemented | Uninstalling also removes saved preferences (Obsidian removes the plugin folder) |

## Features

| feature | status | notes |
|---|---|---|
| Status board cards: principle, next action, done, verification limits, due, owner, decisions, related notes | implemented | Missing values show "Not set"; no tasks -> dashed bar, no fake percentage |
| Board customize (fields, order, status filter, sort) | implemented | Saved; survives restart |
| Create project / task / decision, sample data | implemented | Task and decision pre-select the current project |
| `notebase-status` embed | implemented | |
| Wiki pages, sub-pages, page tree | implemented | |
| `notebase-children`, `notebase-breadcrumb` blocks | implemented | |
| Databases `notebase-db`: table, board, gallery; database view | implemented | Inline status edit; text properties editable |
| Database customize (fields, order, filters, sort) | implemented | Saved per block without changing the note |
| Board drag and drop between columns | implemented | Status dropdown on each card is the tested path; drag was not exercised manually |
| Templates folder, starter templates, new note from template | implemented | Never overwrites |
| Relations panel and `notebase-rollup` | implemented | Count by status, percent done |
| Quick find (`kind:`, `status:`, `project:`, `is:open`, quoted phrases), recent, go to project, next open task | implemented | |
| Import extracted Notion export (Markdown & CSV) | implemented | Dry run first; source files never change |
| CSV / Markdown export | implemented | UTF-8 with BOM |

## Not included

- Cloud features: real-time collaboration, comments, sharing and permissions, API sync, AI features inside the plugin.
- Databases: formulas, typed property editors (select, date, person), timeline/calendar/chart views, OR/nested filter
  groups, several named views per database, column resize and drag reorder.
- Relations: automatic two-way relation editing, a formula language, nested rollups.
- Wiki: page icons and covers, drag re-parenting, rich block editor.
- Quick find: full-text body search (use Obsidian search), viewing history (recent = recently modified).
- Import: ZIP extraction (unzip first), copying attachments.
- Not yet tested on mobile devices or with light themes.
