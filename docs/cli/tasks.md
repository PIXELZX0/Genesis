---
summary: "CLI reference for `genesis tasks` (background task ledger and Task Flow state)"
read_when:
  - You want to inspect, audit, or cancel background task records
  - You are documenting Task Flow commands under `genesis tasks flow`
title: "`genesis tasks`"
---

Inspect durable background tasks and Task Flow state. With no subcommand,
`genesis tasks` is equivalent to `genesis tasks list`.

See [Background Tasks](/automation/tasks) for the lifecycle and delivery model.

## Usage

```bash
genesis tasks
genesis tasks list
genesis tasks list --runtime acp
genesis tasks list --status running
genesis tasks show <lookup>
genesis tasks notify <lookup> state_changes
genesis tasks cancel <lookup>
genesis tasks audit
genesis tasks maintenance
genesis tasks maintenance --apply
genesis tasks flow list
genesis tasks flow show <lookup>
genesis tasks flow cancel <lookup>
```

## Root Options

- `--json`: output JSON.
- `--runtime <name>`: filter by kind: `subagent`, `acp`, `cron`, or `cli`.
- `--status <name>`: filter by status: `queued`, `running`, `succeeded`, `failed`, `timed_out`, `cancelled`, or `lost`.

## Subcommands

### `list`

```bash
genesis tasks list [--runtime <name>] [--status <name>] [--json]
```

Lists tracked background tasks newest first.

### `show`

```bash
genesis tasks show <lookup> [--json]
```

Shows one task by task ID, run ID, or session key.

### `notify`

```bash
genesis tasks notify <lookup> <done_only|state_changes|silent>
```

Changes the notification policy for a running task.

### `cancel`

```bash
genesis tasks cancel <lookup>
```

Cancels a running background task.

### `audit`

```bash
genesis tasks audit [--severity <warn|error>] [--code <name>] [--limit <n>] [--json]
```

Surfaces stale, lost, delivery-failed, or otherwise inconsistent task and Task Flow records.

### `maintenance`

```bash
genesis tasks maintenance [--apply] [--json]
```

Previews or applies task and Task Flow reconciliation, cleanup stamping, and pruning.

### `flow`

```bash
genesis tasks flow list [--status <name>] [--json]
genesis tasks flow show <lookup> [--json]
genesis tasks flow cancel <lookup>
```

Inspects or cancels durable Task Flow state under the task ledger.

## Related

- [CLI reference](/cli)
- [Background tasks](/automation/tasks)
