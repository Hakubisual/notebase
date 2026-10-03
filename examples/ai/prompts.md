# Example prompts

Use these with any assistant that can read and edit your vault, after adding the rules from `AGENTS.md`.

**Create a project**
> Create an Obtion project called "Kitchen renovation" in `Obtion/Projects/`. Fill Principle with one line I give you:
> "Finish one room area per weekend." Add three To do items. Leave owner and due empty.

**Weekly summary (read only)**
> Read all active Obtion projects. For each, give: the next action (first unchecked To do), what was added to Done
> in the last 7 days with its evidence, and any new Verification limits. Do not edit any file.

**Suggest next actions**
> For every active project without an unchecked To do item, suggest one next action and explain why in one line.
> Show the list; do not edit until I approve.

**Triage tasks**
> List Obtion tasks with status `doing` that were not modified in 14 days. Propose a new status for each with a
> reason. Apply only the ones I approve, adding a dated status line to each note.

**Clean up after an import**
> Review notes in `Obtion/Imports/`. Propose a `project` link for tasks that have none, matching existing project
> names. Show the proposal as a table; apply after approval.

**Record a decision**
> Create an Obtion decision "Which drip kit to buy" linked to "[[Garden planner]]" with status `open`, the two
> options I describe, and no `decided` date yet.
