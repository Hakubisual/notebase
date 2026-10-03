# Using Notebase with an AI assistant

Notebase stores everything as plain Markdown with a small frontmatter contract, so any AI assistant that can read and
edit files in your vault (Codex, Claude Code, Cursor, Copilot, local models, ...) can create notes, keep statuses
current, summarize projects and suggest next actions, while the boards stay readable for people.

Quick start: copy [`examples/ai/AGENTS.md`](../examples/ai/AGENTS.md) to the root of your vault (also save it as
`CLAUDE.md` for Claude Code, or use [`examples/ai/notebase.mdc`](../examples/ai/notebase.mdc) as a Cursor rule). Then use
the prompts in [`examples/ai/prompts.md`](../examples/ai/prompts.md).

## The contract

1. **Only notes inside the workspace folder** (default `Notebase/`) with `kit: <kind>` in frontmatter belong to Notebase.
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
- **Stay inside the workspace folder** for anything Notebase-related. Do not touch `.obsidian/` or plugin data.
- **Keep internal bookkeeping out of human fields.** If you track your own session, model or token data, use
  clearly internal keys (`session`, `model`, `agent`, `tokens`, `log`); Notebase hides them by default.
- **Do not change statuses silently.** When you update a status, add one dated line to the note body
  (`- 2026-10-03 · status todo -> doing · reason`).
- **Propose, then apply.** For bulk changes (more than a few notes), list the planned changes and wait for approval.
- **No secrets** (keys, tokens, passwords) in any note.

## Good tasks for an assistant

| task | what to do |
|---|---|
| Create a project | New note in `Notebase/Projects/` with `kit: project`, `status: active`, the four sections, one next action |
| Triage tasks | Read open tasks, suggest status changes with a reason; apply after approval |
| Weekly summary | Per active project: next action, what moved to Done this week (with evidence), new verification limits |
| Suggest next actions | For each project, propose the first unchecked To do item or a missing one; never mark done |
| Clean up | Find tasks without `project`, decisions without `decided`, wiki pages without `parent`; list them |
| Import | After a Notebase import, review the `Imports/` notes and propose project links |

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

## 中文摘要（简体）

Notebase 把所有内容都保存为普通 Markdown，并使用一小套固定的 frontmatter 约定。任何能读写你库中文件的 AI 助手
（Codex、Claude Code、Cursor、Copilot、本地模型等）都可以创建笔记、更新状态、总结项目、建议下一步，而看板依然便于人阅读。

快速开始：把 [`examples/ai/AGENTS.md`](../examples/ai/AGENTS.md) 复制到库的根目录（Claude Code 另存为 `CLAUDE.md`，Cursor 可使用
[`examples/ai/notebase.mdc`](../examples/ai/notebase.mdc)），再参考 [`examples/ai/prompts.md`](../examples/ai/prompts.md) 中的示例提示词。

**约定**
- 只有位于工作区文件夹（默认 `Notebase/`）内、且 frontmatter 含有 `kit: <kind>` 的笔记属于 Notebase。
  类型：`project`、`task`、`decision`、`wiki`、`record`。
- 状态只用上文列出的值（例如项目：`active`、`paused`、`done`、`dropped`；任务：`todo`、`doing`、`blocked`、`done`、`dropped`）。
- 面向人的字段优先：`status`、`owner`、`due`（YYYY-MM-DD）、`priority`、`project`（链接）、`decided`、`verified`、`parent`。
- 链接使用带引号的 wikilink：`project: "[[Garden planner]]"`。
- 项目笔记保持四个小节：Principle（原则）、To do（待办，第一个未勾选项即下一步）、Done（已完成及证据位置）、
  Verification limits（尚未验证的内容及原因）。

**AI 助手安全规则**
- 不编造数据：不知道的 `owner`、`due`、`verified` 留空；没有可打开的证据不标记 `done` 或 `verified`。
- 不覆盖、不重命名、不删除笔记；新文件使用未占用的名称，只修改需要的行。
- 只在工作区文件夹内操作，不要改动 `.obsidian/` 或插件数据。
- 自己的记录（会话、模型、token、日志）写入内部字段 `session`、`model`、`agent`、`tokens`、`log`，Notebase 默认隐藏它们。
- 修改状态时在正文加一行带日期的记录；批量修改先列出计划，等待确认后再执行。
- 任何笔记中都不要写入密钥、令牌或密码。
