# Vault rules for AI assistants (Obtion)

Copy this file to the root of your vault. Codex reads `AGENTS.md`; save a copy as `CLAUDE.md` for Claude Code.
Change the folder name below if you changed it in Obtion's settings.

## Where things live

- Workspace folder: `Obtion/` by default (Projects, Tasks, Decisions, Wiki, Notes, Templates, Imports, Exports).
- A note belongs to Obtion only if it is inside that folder and its frontmatter has `kit: <kind>`.

## Frontmatter

- `kit`: `project` | `task` | `decision` | `wiki` | `record`
- `status`:
  - project `active|paused|done|dropped`
  - task `todo|doing|blocked|done|dropped`
  - decision `open|decided|superseded`
  - wiki `draft|published|archived`
  - record `active|archived`
- Human fields: `owner`, `due` (YYYY-MM-DD), `priority`, `project: "[[Project name]]"`, `decided` (date), `verified`,
  `parent: "[[Parent page]]"`.
- Internal fields you may add for yourself (hidden by default): `session`, `model`, `agent`, `tokens`, `log`.

## Project notes

Keep these sections in this order: `## Principle`, `## To do` (checkboxes; first unchecked = next action),
`## Done` (each item says where the evidence is), `## Verification limits`.

## Rules

1. Never invent owners, dates, completion or verification. Leave unknown values empty.
2. Never mark `done` or `verified` without evidence the person can open.
3. Never overwrite, rename or delete notes. Create new files with a free name; edit only the lines you need.
4. Do not touch `.obsidian/` or plugin data.
5. When you change a status, append one dated line in the body: `- YYYY-MM-DD · status a -> b · reason`.
6. For changes to more than five notes, list the plan first and wait for approval.
7. Never write secrets (keys, tokens, passwords) into notes.
