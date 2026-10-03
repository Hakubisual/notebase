# Notion import pack (synthetic sample data)

This folder lets anyone recreate the Obtion layout in their own Notion workspace. Nothing here talks to Notion automatically; you import the files yourself.

## Import (official Notion importer)

1. In Notion: **Settings → Import → CSV**. Import `Projects.csv`, then `Tasks.csv`, then `Decisions.csv`. Each becomes a database.
   Source: https://www.notion.com/help/import-data-into-notion
2. In **Tasks** and **Decisions**, change the `Project` property type to **Relation → Projects**. Notion matches the text to project names.
   (CSV import never creates relations, formulas or rollups by itself.)
3. In **Projects**, add a **Rollup** "Open tasks" (Relation: Tasks, Property: Status, Calculate: count values not "Done") if you want counts.
4. Create views:
   - Projects → **Board** grouped by Status; card preview shows Next action, Owner, Due, Verification limits.
   - Tasks → **Table** filtered "Status is not Done", sorted by Due.
   - Decisions → **List** filtered "Status is Open".
5. Import `pages/Project page template.md` with **Settings → Import → Text & Markdown** and set it as the Projects database template.
6. Hide properties you do not need with **Properties → hide in view**. Empty Owner or Due stay empty; do not fill them with guesses.

## Limits (honest)

- Not tested inside a live Notion workspace from this project (no external writes were allowed). The CSV follows RFC 4180 with a UTF-8 BOM, which Notion's CSV importer accepts.
- Relations, rollups and views must be created by hand after import (Notion limitation for CSV).
- Publishing as a Notion template or listing on Marketplace needs the author's own Notion account; see `marketplace-checklist.md`.
