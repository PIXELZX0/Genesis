---
summary: "CLI reference for `genesis backup` (create local backup archives)"
read_when:
  - You want a first-class backup archive for local Genesis state
  - You want to preview which paths would be included before reset or uninstall
title: "Backup"
---

# `genesis backup`

Create a local backup archive for Genesis state, config, auth profiles, channel/provider credentials, sessions, and optionally workspaces.

```bash
genesis backup create
genesis backup create --output ~/Backups
genesis backup create --dry-run --json
genesis backup create --verify
genesis backup create --no-include-workspace
genesis backup create --only-config
genesis backup verify ./2026-03-09T00-00-00.000Z-genesis-backup.tar.gz
```

## Notes

- The archive includes a `manifest.json` file with the resolved source paths and archive layout.
- Default output is a timestamped `.tar.gz` archive in the current working directory.
- If the current working directory is inside a backed-up source tree, Genesis falls back to your home directory for the default archive location.
- Existing archive files are never overwritten.
- Output paths inside the source state/workspace trees are rejected to avoid self-inclusion.
- `genesis backup verify <archive>` validates that the archive contains exactly one root manifest, rejects traversal-style archive paths, and checks that every manifest-declared payload exists in the tarball.
- `genesis backup create --verify` runs that validation immediately after writing the archive.
- `genesis backup create --only-config` backs up just the active JSON config file.

## What gets backed up

`genesis backup create` plans backup sources from your local Genesis install:

- The state directory returned by Genesis's local state resolver, usually `~/.genesis`
- The active config file path
- The resolved `credentials/` directory when it exists outside the state directory
- Workspace directories discovered from the current config, unless you pass `--no-include-workspace`

Model auth profiles are already part of the state directory under
`agents/<agentId>/agent/auth-profiles.json`, so they are normally covered by the
state backup entry.

If you use `--only-config`, Genesis skips state, credentials-directory, and workspace discovery and archives only the active config file path.

Genesis canonicalizes paths before building the archive. If config, the
credentials directory, or a workspace already live inside the state directory,
they are not duplicated as separate top-level backup sources. Missing paths are
skipped.

The archive payload stores file contents from those source trees, and the embedded `manifest.json` records the resolved absolute source paths plus the archive layout used for each asset.

## Invalid config behavior

`genesis backup` intentionally bypasses the normal config preflight so it can still help during recovery. Because workspace discovery depends on a valid config, `genesis backup create` now fails fast when the config file exists but is invalid and workspace backup is still enabled.

If you still want a partial backup in that situation, rerun:

```bash
genesis backup create --no-include-workspace
```

That keeps state, config, and the external credentials directory in scope while
skipping workspace discovery entirely.

If you only need a copy of the config file itself, `--only-config` also works when the config is malformed because it does not rely on parsing the config for workspace discovery.

## Size and performance

Genesis does not enforce a built-in maximum backup size or per-file size limit.

Practical limits come from the local machine and destination filesystem:

- Available space for the temporary archive write plus the final archive
- Time to walk large workspace trees and compress them into a `.tar.gz`
- Time to rescan the archive if you use `genesis backup create --verify` or run `genesis backup verify`
- Filesystem behavior at the destination path. Genesis prefers a no-overwrite hard-link publish step and falls back to exclusive copy when hard links are unsupported

Large workspaces are usually the main driver of archive size. If you want a smaller or faster backup, use `--no-include-workspace`.

For the smallest archive, use `--only-config`.

## Related

- [CLI reference](/cli)
