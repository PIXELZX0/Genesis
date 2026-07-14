# Orca IDE (plugin)

Adds the `orca_worktree` and `orca_terminal` agent tools, letting a Genesis
agent create and drive worktrees/terminals in a running
[Orca IDE](https://github.com/stablyai/orca) instance via its `orca` CLI.

## What this is

- Orca IDE orchestrates fleets of coding-agent CLIs, each in its own git
  worktree + terminal. This plugin shells out to the `orca` CLI (`--json` on
  every call) to create/select worktrees and read/send/wait on their
  terminals.
- File I/O does **not** go through this plugin — once a worktree's
  `worktreePath` is known, use Genesis's own Read/Write/Edit/Glob tools on
  that path directly. See `skills/orca-ide/SKILL.md` for the full workflow.
- Stateless: every tool call is one `orca` subprocess invocation, not a
  persistent connection.

## Enable

Because `orca_worktree.create` can launch an arbitrary agent CLI and
`orca_terminal.send` can execute arbitrary commands inside a real terminal,
both tools are registered with `optional: true`.

Enable them in an agent allowlist:

```json
{
  "agents": {
    "list": [
      {
        "id": "main",
        "tools": {
          "allow": [
            "orca-ide" // plugin id (enables both tools from this plugin)
          ]
        }
      }
    ]
  }
}
```

## Config

| Field                | Default | Notes                                                                                                                                                             |
| -------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `command`            | `orca`  | On Linux, outside an Orca-managed terminal, use `orca-ide` instead — bare `orca` is the GNOME screen reader there. Overridden by `ORCA_CLI_COMMAND` env when set. |
| `environment`        | —       | Optional remote Orca runtime id (`orca environment add`), passed as `--environment`.                                                                              |
| `pairingCode`        | —       | Optional one-off remote pairing code, passed as `--pairing-code`.                                                                                                 |
| `timeoutSeconds`     | `30`    | Timeout for most `orca` CLI invocations.                                                                                                                          |
| `waitTimeoutSeconds` | `300`   | Ceiling for `orca_terminal`'s `wait` action.                                                                                                                      |

## Security

- Commands are built as argv arrays and never run through a shell, so
  config-supplied `command`/`environment` values carry no shell-injection
  surface.
- `pairingCode` is declared as a `configContracts.secretInputs` path, so it
  is covered by Genesis's generic secret-input handling and audit checks.
