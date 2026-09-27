import { Help, type Command, type Option } from "commander";
import { resolveCommitHash } from "../../infra/git-commit.js";
import { formatDocsLink } from "../../terminal/links.js";
import { isRich, theme } from "../../terminal/theme.js";
import { escapeRegExp } from "../../utils.js";
import { hasFlag, hasRootVersionAlias } from "../argv.js";
import { formatCliBannerLine, hasEmittedCliBanner } from "../banner.js";
import { replaceCliName, resolveCliName } from "../cli-name.js";
import { CLI_LOG_LEVEL_VALUES, parseCliLogLevelOption } from "../log-level-option.js";
import type { ProgramContext } from "./context.js";
import { getCoreCliCommandsWithSubcommands } from "./core-command-descriptors.js";
import { getSubCliCommandsWithSubcommands } from "./subcli-descriptors.js";

const CLI_NAME = resolveCliName();
const CLI_NAME_PATTERN = escapeRegExp(CLI_NAME);
const ROOT_COMMANDS_WITH_SUBCOMMANDS = new Set([
  ...getCoreCliCommandsWithSubcommands(),
  ...getSubCliCommandsWithSubcommands(),
]);
const ROOT_COMMANDS_HINT =
  "Hint: commands suffixed with * have subcommands. Run <command> --help for details.";

// Root help groups, in display order. Commands not listed here (plugin commands,
// `help`) land in the trailing "Other commands:" group.
const ROOT_COMMAND_GROUPS: ReadonlyArray<readonly [heading: string, names: readonly string[]]> = [
  [
    "Get started:",
    ["onboard", "setup", "configure", "dashboard", "chat", "status", "doctor", "update"],
  ],
  ["Agents & chat:", ["agent", "agents", "tui", "sessions", "message", "memory", "tasks"]],
  [
    "Connect:",
    [
      "channels",
      "models",
      "mcp",
      "plugins",
      "skills",
      "nodes",
      "node",
      "devices",
      "pairing",
      "qr",
      "directory",
      "wallet",
    ],
  ],
  ["Automation:", ["cron", "hooks", "webhooks", "approvals", "exec-policy"]],
  [
    "Gateway & system:",
    ["gateway", "logs", "health", "system", "sandbox", "secrets", "security", "backup"],
  ],
  [
    "Advanced:",
    [
      "config",
      "acp",
      "infer",
      "proxy",
      "dns",
      "docs",
      "completion",
      "migrate",
      "reset",
      "uninstall",
    ],
  ],
];
const OTHER_COMMANDS_GROUP = "Other commands:";
const ROOT_COMMAND_GROUP_BY_NAME = new Map(
  ROOT_COMMAND_GROUPS.flatMap(([heading, names]) => names.map((name) => [name, heading] as const)),
);
const ROOT_COMMAND_GROUP_ORDER = [
  ...ROOT_COMMAND_GROUPS.map(([heading]) => heading),
  OTHER_COMMANDS_GROUP,
];
const ROOT_HELP_HEADINGS = ["Usage:", "Options:", "Commands:", ...ROOT_COMMAND_GROUP_ORDER];
// Legacy aliases stay runnable but out of root help; each has a listed twin.
const HIDDEN_ROOT_COMMANDS = new Set(["capability", "clawbot", "daemon", "terminal"]);

const EXAMPLES = [
  [
    "genesis onboard --install-daemon",
    "First run: set up a model, your workspace, and the background gateway.",
  ],
  ["genesis chat", "Chat with your agent in the terminal."],
  ["genesis dashboard", "Open the Control UI in your browser."],
  ["genesis channels add", "Connect Telegram, Discord, WhatsApp, and other channels."],
  ["genesis status --deep", "Check gateway, channel, and model health."],
  ["genesis doctor", "Find and fix common setup problems."],
  ["genesis --dev gateway", "Run a dev Gateway (isolated state/config) on ws://127.0.0.1:19001."],
  ["genesis <command> --help", "Show detailed help for any command."],
] as const;

export function configureProgramHelp(program: Command, ctx: ProgramContext) {
  program
    .name(CLI_NAME)
    .description("")
    .version(ctx.programVersion)
    .option(
      "--container <name>",
      "Run the CLI inside a running Podman/Docker container named <name> (default: env GENESIS_CONTAINER)",
    )
    .option(
      "--dev",
      "Dev profile: isolate state under ~/.genesis-dev, default gateway port 19001, and shift derived ports (browser/canvas)",
    )
    .option(
      "--profile <name>",
      "Use a named profile (isolates GENESIS_STATE_DIR/GENESIS_CONFIG_PATH under ~/.genesis-<name>)",
    )
    .option(
      "--log-level <level>",
      `Global log level override for file + console (${CLI_LOG_LEVEL_VALUES})`,
      parseCliLogLevelOption,
    );

  program.option("--no-color", "Disable ANSI colors", false);
  program.helpOption("-h, --help", "Display help for command");
  program.helpCommand("help [command]", "Display help for command");

  program.configureHelp({
    // sort options and subcommands alphabetically
    sortSubcommands: true,
    sortOptions: true,
    optionTerm: (option) => theme.option(option.flags),
    visibleCommands(cmd) {
      const commands = Help.prototype.visibleCommands.call(this, cmd);
      if (cmd !== program) {
        return commands;
      }
      return commands.filter((sub) => {
        if (HIDDEN_ROOT_COMMANDS.has(sub.name())) {
          return false;
        }
        if (!sub.helpGroup()) {
          sub.helpGroup(ROOT_COMMAND_GROUP_BY_NAME.get(sub.name()) ?? OTHER_COMMANDS_GROUP);
        }
        return true;
      });
    },
    groupItems<T extends Command | Option>(
      unsortedItems: T[],
      visibleItems: T[],
      getGroup: (item: T) => string,
    ): Map<string, T[]> {
      // The base implementation is stateless, so calling it off the prototype is safe.
      const groups = Help.prototype.groupItems(unsortedItems, visibleItems, getGroup);
      if (!unsortedItems.some((item) => "parent" in item && item.parent === program)) {
        return groups;
      }
      // Registration order is lazy/plugin-dependent; pin the documented order.
      const ordered = new Map<string, T[]>();
      for (const [heading, names] of ROOT_COMMAND_GROUPS) {
        const items = groups.get(heading);
        if (items?.length) {
          ordered.set(
            heading,
            items.toSorted(
              (a, b) => names.indexOf((a as Command).name()) - names.indexOf((b as Command).name()),
            ),
          );
        }
      }
      for (const [heading, items] of groups) {
        if (!ordered.has(heading) && items.length) {
          ordered.set(heading, items);
        }
      }
      return ordered;
    },
    subcommandTerm: (cmd) => {
      const isRootCommand = cmd.parent === program;
      const hasSubcommands = isRootCommand && ROOT_COMMANDS_WITH_SUBCOMMANDS.has(cmd.name());
      return theme.command(hasSubcommands ? `${cmd.name()} *` : cmd.name());
    },
  });

  const formatHelpOutput = (str: string) => {
    let output = str;
    const isRootHelp = new RegExp(
      `^Usage:\\s+${CLI_NAME_PATTERN}\\s+\\[options\\]\\s+\\[command\\]\\s*$`,
      "m",
    ).test(output);
    if (isRootHelp) {
      const firstGroup = ROOT_COMMAND_GROUP_ORDER.find((heading) =>
        new RegExp(`^${escapeRegExp(heading)}`, "m").test(output),
      );
      if (firstGroup) {
        output = output.replace(
          new RegExp(`^${escapeRegExp(firstGroup)}`, "m"),
          `${firstGroup}\n  ${theme.muted(ROOT_COMMANDS_HINT)}`,
        );
      }
    }

    for (const heading of ROOT_HELP_HEADINGS) {
      output = output.replace(
        new RegExp(`^${escapeRegExp(heading)}`, "gm"),
        theme.heading(heading),
      );
    }
    return output;
  };

  program.configureOutput({
    writeOut: (str) => {
      process.stdout.write(formatHelpOutput(str));
    },
    writeErr: (str) => {
      process.stderr.write(formatHelpOutput(str));
    },
    outputError: (str, write) => write(theme.error(str)),
  });

  if (
    hasFlag(process.argv, "-V") ||
    hasFlag(process.argv, "--version") ||
    hasRootVersionAlias(process.argv)
  ) {
    const commit = resolveCommitHash({ moduleUrl: import.meta.url });
    console.log(
      commit ? `Genesis ${ctx.programVersion} (${commit})` : `Genesis ${ctx.programVersion}`,
    );
    process.exit(0);
  }

  program.addHelpText("beforeAll", () => {
    if (hasEmittedCliBanner()) {
      return "";
    }
    const rich = isRich();
    const line = formatCliBannerLine(ctx.programVersion, { richTty: rich });
    return `\n${line}\n`;
  });

  const fmtExamples = EXAMPLES.map(
    ([cmd, desc]) => `  ${theme.command(replaceCliName(cmd, CLI_NAME))}\n    ${theme.muted(desc)}`,
  ).join("\n");

  program.addHelpText("afterAll", ({ command }) => {
    if (command !== program) {
      return "";
    }
    const docs = formatDocsLink("/cli", "genesis.pixelzx.com/docs/cli");
    return `\n${theme.heading("Examples:")}\n${fmtExamples}\n\n${theme.muted("Docs:")} ${docs}\n`;
  });
}
