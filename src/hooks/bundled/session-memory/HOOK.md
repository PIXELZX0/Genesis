---
name: session-memory
description: "Save session context to memory when /new or /reset command is issued"
homepage: https://genesis.pixelzx.com/docs/automation/hooks#session-memory
metadata:
  {
    "genesis":
      {
        "emoji": "💾",
        "events": ["command:new", "command:reset"],
        "requires": { "config": ["workspace.dir"] },
        "install": [{ "id": "bundled", "kind": "bundled", "label": "Bundled with Genesis" }],
      },
  }
---

# Session Memory Hook

Automatically saves session context to your workspace memory when you issue `/new` or `/reset`.

## What It Does

When you run `/new` or `/reset` to start a fresh session:

1. **Finds the previous session** - Uses the pre-reset session entry to locate the correct transcript
2. **Extracts conversation** - Reads the last N user/assistant messages from the session (default: 15, configurable)
3. **Saves to memory** - Creates a new file at `<workspace>/memory/YYYY-MM-DD-HHMM.md` right away
4. **Generates descriptive slug** - Asks the LLM for a meaningful slug in the background, then renames the file to `<workspace>/memory/YYYY-MM-DD-slug.md`

Slug generation never blocks `/new` or `/reset`. The new session's startup context matches memory files by date prefix, so it picks the file up under either name.

## Output Format

Memory files are created with the following format:

```markdown
# Session: 2026-01-16 14:30:00 UTC

- **Session Key**: agent:main:main
- **Session ID**: abc123def456
- **Source**: telegram
```

## Filename Examples

The LLM generates descriptive slugs based on your conversation:

- `2026-01-16-vendor-pitch.md` - Discussion about vendor evaluation
- `2026-01-16-api-design.md` - API architecture planning
- `2026-01-16-bug-fix.md` - Debugging session
- `2026-01-16-1430.md` - Timestamp name, kept if slug generation fails or is disabled

## Requirements

- **Config**: `workspace.dir` must be set (automatically configured during setup)

The hook uses your configured LLM provider to generate slugs, so it works with any provider (Anthropic, OpenAI, etc.). Set `llmSlug` to `false` to skip the slug call entirely and keep the timestamp names.

## Configuration

The hook supports optional configuration:

| Option     | Type    | Default | Description                                                       |
| ---------- | ------- | ------- | ----------------------------------------------------------------- |
| `messages` | number  | 15      | Number of user/assistant messages to include in the memory file   |
| `llmSlug`  | boolean | true    | Rename the memory file to an LLM-generated slug in the background |

Example configuration:

```json
{
  "hooks": {
    "internal": {
      "entries": {
        "session-memory": {
          "enabled": true,
          "messages": 25
        }
      }
    }
  }
}
```

The hook automatically:

- Uses your workspace directory (`~/.genesis/workspace` by default)
- Uses your configured LLM for slug generation
- Falls back to timestamp slugs if LLM is unavailable

## Disabling

To disable this hook:

```bash
genesis hooks disable session-memory
```

Or remove it from your config:

```json
{
  "hooks": {
    "internal": {
      "entries": {
        "session-memory": { "enabled": false }
      }
    }
  }
}
```
