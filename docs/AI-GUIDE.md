# Using Obtion with an AI assistant

Obtion stores everything as plain Markdown with a small frontmatter contract, so any AI assistant that can read and
edit files in your vault (Codex, Claude Code, Cursor, Copilot, local models, ...) can create notes, keep statuses
current, summarize projects and suggest next actions, while the boards stay readable for people.

Quick start: copy [`examples/ai/AGENTS.md`](../examples/ai/AGENTS.md) to the root of your vault (also save it as
`CLAUDE.md` for Claude Code, or use [`examples/ai/obtion.mdc`](../examples/ai/obtion.mdc) as a Cursor rule). Then use
the prompts in [`examples/ai/prompts.md`](../examples/ai/prompts.md).

## The contract

1. **Only notes inside the workspace folder** (default `Obtion/`) with `kit: <kind>` in frontmatter belong to Obtion.
   Kinds: `project`, `task`, `decision`, `wiki`, `record`.
2. **Statuses** (use exactly these values):
   - project: `active`, `paused`, `done`, `dropped`
   - task: `todo`, `doing`, `blocked`, `done`, `dropped`
   - decision: `open`, `decided`, `superseded`
   - wiki: `draft`, `published`, `archived`
   - record: `active`, `archived`
3. **Human fields first.** These are what people see on boards: `status`, `owner`, `due` (YYYY-MM-DD), `priority`,
   `project` (link), `decided` (date), `verified`, `parent` (wiki link). Keep values short and human-readable.
4. **Links** use wikilinks in quotes: `project: "[[Garden planner]]"`.
5. **Project notes** keep four sections in this order (headings may be renamed in settings; follow the vault's
   existing headings):
   - `## Principle` - how the project works, one or two lines.
   - `## To do` - checkbox list, the first unchecked item is the next action.
   - `## Done` - finished results, each with where the evidence is.
   - `## Verification limits` - what has not been checked yet, and why.

## Safety rules for AI assistants

- **Never invent data.** Leave `owner`, `due`, `verified` empty when you do not know them. Never mark something
  `done` or `verified` without evidence the person can open (a file, a link, a test result).
- **Never overwrite or delete notes.** Create new files with a free name; edit only the lines you need.
- **Stay inside the workspace folder** for anything Obtion-related. Do not touch `.obsidian/` or plugin data.
- **Keep internal bookkeeping out of human fields.** If you track your own session, model or token data, use
  clearly internal keys (`session`, `model`, `agent`, `tokens`, `log`); Obtion hides them by default.
- **Do not change statuses silently.** When you update a status, add one dated line to the note body
  (`- 2026-10-03 · status todo -> doing · reason`).
- **Propose, then apply.** For bulk changes (more than a few notes), list the planned changes and wait for approval.
- **No secrets** (keys, tokens, passwords) in any note.

## Good tasks for an assistant

| task | what to do |
|---|---|
| Create a project | New note in `Obtion/Projects/` with `kit: project`, `status: active`, the four sections, one next action |
| Triage tasks | Read open tasks, suggest status changes with a reason; apply after approval |
| Weekly summary | Per active project: next action, what moved to Done this week (with evidence), new verification limits |
| Suggest next actions | For each project, propose the first unchecked To do item or a missing one; never mark done |
| Clean up | Find tasks without `project`, decisions without `decided`, wiki pages without `parent`; list them |
| Import | After an Obtion import, review the `Imports/` notes and propose project links |

## Example notes

```markdown
---
kit: task
status: doing
project: "[[Garden planner]]"
owner: Alex
due: 2026-11-01
---
Order compost for the north bed.

- 2026-10-03 · status todo -> doing · supplier confirmed
```

```markdown
---
kit: project
status: active
owner: ""
due: ""
---
## Principle
- Plan beds by sunlight hours, then pick plants that fit each bed.

## To do
- [ ] Order compost for the north bed

## Done
- Built two raised beds (photos in Attachments/beds)

## Verification limits
- Soil pH not tested yet.
```
