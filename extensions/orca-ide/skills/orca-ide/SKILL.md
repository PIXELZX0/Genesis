---
name: orca-ide
description: Drive Orca IDE (worktrees + terminals) with the orca_worktree and orca_terminal tools. Use for "Orca worktree", "run this in Orca IDE", "spawn an agent in Orca", "read/send the Orca terminal" — the separate Orca IDE desktop app, not Genesis's own worktree/exec tools.
---

# Orca IDE

`orca_worktree` and `orca_terminal` drive a running Orca IDE instance
(https://github.com/stablyai/orca) through its `orca` CLI. Only use these
when the user explicitly means the separate Orca IDE app — for Genesis's own
sandboxing/exec, use Genesis's normal tools instead.

## File I/O does not go through this tool

`orca_worktree`'s `create`/`show` actions return a `worktreePath` — a real
git checkout on disk. Once you have it, read and edit files with Genesis's
own Read/Write/Edit/Glob tools directly on that path. Neither tool here
reads or writes file contents; Orca's own `file` CLI family only opens files
in the Orca editor UI for a human, so there is nothing to wrap.

## Worktree flow

1. `orca_worktree action=create name=<name> [agent=<id>] [prompt=<text>] [baseBranch=<ref>]` —
   creates a worktree, optionally launching an agent CLI (`claude`, `codex`, etc.)
   inside it with an initial prompt.
2. `orca_worktree action=show worktree=<selector>` — get the `worktreePath` and
   status. Selectors accept `id:`, `name:`, `path:`, `branch:` prefixes, or `active`.
3. `orca_worktree action=list` / `action=ps` — enumerate worktrees / running processes.
4. `orca_worktree action=rm worktree=<selector> [force=true]` — tear down when done.

Worktree ids are `<repoId>::<worktreePath>`.

## Terminal flow

Drive the terminal running inside a worktree in a loop:

1. `orca_terminal action=read terminal=<handle>` — read output. Response is
   cursor-paginated (`oldestCursor`, `nextCursor`, `limited`); pass the previous
   `nextCursor` back in as `cursor` to read only new output.
2. `orca_terminal action=send terminal=<handle> text=<text> [enter=true]` — send
   input. `interrupt=true` sends an interrupt (Ctrl-C-style) instead of literal text.
3. `orca_terminal action=wait terminal=<handle> for=tui-idle|exit [timeoutMs=<n>]` —
   block until the terminal goes idle (agent finished a turn) or the process exits.
4. Repeat `read` with the new cursor to see what happened.

`orca_terminal action=list` / `action=create` / `action=split` / `action=rename` /
`action=switch` / `action=close` / `action=stop` manage terminal lifecycle and
layout within a worktree.

## Beyond worktree + terminal

Orca's browser control, `orchestration` (task DAGs, ask/reply, decision gates),
`computer-use` (desktop UI automation), and emulator command families are real
but out of scope for these two tools — Orca ships its own first-party skills
for those (`orchestration`, `computer-use`, `orca-emulator`). Don't try to
reinvent them by shelling raw `orca` commands through Genesis's exec tool
instead; if driving those is needed, look for the matching first-party Orca
skill first.

## Executable name

If `orca_worktree`/`orca_terminal` report the CLI binary can't be found,
check `orca-ide.command` in plugin config — on Linux, outside an
Orca-managed terminal, bare `orca` resolves to the GNOME Orca screen reader,
not this CLI. Set it to `orca-ide` (or the `$ORCA_CLI_COMMAND` value Orca
itself sets in managed sessions) instead.
