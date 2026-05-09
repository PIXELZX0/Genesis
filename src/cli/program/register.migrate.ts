import type { Command } from "commander";
import { migrateCommand } from "../../commands/migrate.js";
import { defaultRuntime } from "../../runtime.js";
import { formatDocsLink } from "../../terminal/links.js";
import { theme } from "../../terminal/theme.js";
import { runCommandWithRuntime } from "../cli-utils.js";
import { formatHelpExamples } from "../help-format.js";

export function registerMigrateCommand(program: Command) {
  program
    .command("migrate <source>")
    .description("Import config and local state from OpenClaw or Hermes Agent")
    .option("--source-dir <path>", "Source state/home directory")
    .option("--source-config <path>", "Source config file path")
    .option("--dry-run", "Preview the migration plan without writing files", false)
    .option("--force", "Overwrite existing Genesis files and config fields", false)
    .option("--json", "Output JSON", false)
    .addHelpText(
      "after",
      () =>
        `\n${theme.heading("Examples:")}\n${formatHelpExamples([
          ["genesis migrate openclaw --dry-run", "Preview import from ~/.openclaw."],
          ["genesis migrate openclaw", "Import OpenClaw config and state into Genesis."],
          ["genesis migrate hermes --dry-run", "Preview import from ~/.hermes."],
          [
            "genesis migrate hermes --source-dir ~/.hermes-work",
            "Import a non-default Hermes home directory.",
          ],
        ])}\n\n${theme.muted("Docs:")} ${formatDocsLink("/cli/migrate", "docs.genesis.ai/cli/migrate")}\n`,
    )
    .action(async (source, opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await migrateCommand(defaultRuntime, source as string, {
          sourceDir: opts.sourceDir as string | undefined,
          sourceConfig: opts.sourceConfig as string | undefined,
          dryRun: Boolean(opts.dryRun),
          force: Boolean(opts.force),
          json: Boolean(opts.json),
        });
      });
    });
}
