# Edit diffs + "Allow all edits this session"

**Date:** 2026-06-15
**Status:** Approved — ready for implementation planning

## Problem

When Claude Code proposes a file edit, the Footman permission balloon shows only
the tool name and the file path — the user can't see *what* is changing before
clicking Allow/Deny. There is also no way to grant edits for the rest of the
session: the only "remember this" option is the persisted "Always allow …" rule
that Claude suggests. The user wants to (1) see the proposed edit, and (2) get a
button that allows all edits for the current session only.

## Goals

1. Render the actual proposed change as a diff in the permission balloon for the
   file-writing tools.
2. Add an "Allow all edits this session" button that grants a **session-scoped**
   allow rule for the file-writing tools — never written to settings, gone when
   the session ends.

## Scope

- **Edit tools covered:** `Edit`, `Write`, `MultiEdit`, `NotebookEdit`.
- All other tools (Bash/commands, Read, WebFetch, etc.) are unchanged.

## Non-goals

- Permissions for Bash or other non-file-writing tools.
- Line-aligned (LCS) diffs — a simple block diff (old block, then new block) is
  sufficient.
- Syntax highlighting of the diff.

## Design

All logic lives in the existing PermissionRequest hook
(`scripts/permission-prompt.mjs`) plus a small cosmetic change in the widget
renderer. No new processes, no state files, no settings writes.

### 1. Edit preview (diff)

Add a pure helper `buildEditPreview(toolName, input)` that returns a diff string
for the four file-writing tools, or `null` for any other tool:

- **Edit** — unified-style diff: each `old_string` line prefixed `-`, each
  `new_string` line prefixed `+`.
- **MultiEdit** — one `-`/`+` block per entry in `edits[]`, separated by a blank
  line.
- **Write** — the new `content`, every line prefixed `+` (it is a full write).
- **NotebookEdit** — the `new_source`, every line prefixed `+`, labeled by
  `cell_id` / `edit_mode` when present.

`buildMessage` is updated so that for these tools the heading becomes
`<Tool> · <path>` (keeping the path visible since the body is now the diff) and
the body is the diff. Every other tool keeps the current
`"<Tool>\n<detail>"` behavior exactly.

**Truncation:** cap the preview at ~40 lines and ~2000 characters; overflow is
replaced with a `… (N more lines)` marker so a large rewrite cannot fill the
screen. The body still renders in the existing `.balloon-code` monospace frame.

### 2. Red/green coloring (renderer)

In `electron-app/src/renderer.js`, when `kind === 'permission'`, split the code
body into lines and tag each by its leading character: `+` → add, `-` → del,
otherwise neutral. Two CSS rules in `electron-app/src/styles.css`
(`.balloon-code .add` green, `.balloon-code .del` red). Purely cosmetic — if the
renderer change is absent the diff still reads correctly as plain monospace text.

### 3. "Allow all edits this session" button

In `buildOptions`, when `tool_name` is one of `Edit` / `Write` / `MultiEdit` /
`NotebookEdit`, insert one extra button immediately after **Allow**:

```js
{
  label: 'Allow all edits this session',
  decision: decision({
    behavior: 'allow',
    updatedPermissions: [{
      type: 'addRules',
      behavior: 'allow',
      destination: 'session',
      rules: [
        { toolName: 'Edit' },
        { toolName: 'Write' },
        { toolName: 'MultiEdit' },
        { toolName: 'NotebookEdit' },
      ],
    }],
  }),
}
```

`destination: 'session'` is a valid `PermissionUpdateDestination` (verified
against the Claude Agent SDK type definitions — `PermissionUpdate` is
`{type:'addRules', rules: PermissionRuleValue[], behavior, destination}` and a
`PermissionRuleValue` of `{toolName:'Edit'}` with no `ruleContent` allows all
`Edit` calls). Because it is a real Claude allow rule scoped to the session:

- nothing is written to `settings.json`;
- the rule disappears when the session ends;
- subsequent edits in the session are auto-allowed by Claude and the hook does
  not fire again.

The existing **Allow**, **Always allow …** (from `permission_suggestions`), and
**Deny** buttons remain. "When not set": skip adding our button if
`permission_suggestions` already contains an equivalent session-scoped edit rule,
so we never duplicate an option Claude already offers.

## Components

| Unit | File | Responsibility | Inputs |
| --- | --- | --- | --- |
| `buildEditPreview` | `scripts/permission-prompt.mjs` | Diff string for edit tools, with truncation | `toolName`, `tool_input` |
| `buildMessage` (updated) | `scripts/permission-prompt.mjs` | `Tool · path` heading + diff for edit tools; unchanged otherwise | payload |
| `buildOptions` (updated) | `scripts/permission-prompt.mjs` | Insert session-allow button for edit tools when not already offered | payload |
| diff coloring | `electron-app/src/renderer.js`, `styles.css` | Color `+`/`-` lines in the permission code frame | rendered message |

## Testing

Extend `scripts/permission-prompt.test.mjs` (same `node --test` style, pure
functions):

- `buildEditPreview` for Edit / MultiEdit / Write / NotebookEdit, plus
  truncation behavior.
- `buildMessage` produces the `Tool · path` heading + diff for edit tools, and is
  unchanged for non-edit tools (existing assertions stay green).
- `buildOptions` inserts the session button only for edit tools, omits it when an
  equivalent session suggestion already exists, and the emitted decision carries
  the exact session-scoped `updatedPermissions` shape above.

## Error handling / edge cases

- Missing `old_string`/`new_string`/`content` → render whatever is present;
  fall back to the current path-only message if the input has no renderable edit
  content.
- Non-edit tools → `buildEditPreview` returns `null` and all current behavior is
  preserved.
- Renderer receiving a diff but lacking the coloring change → still legible as
  monospace text.
