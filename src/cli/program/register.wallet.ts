import type { Command } from "commander";
import { defaultRuntime, writeRuntimeJson } from "../../runtime.js";
import { theme } from "../../terminal/theme.js";
import { generateWalletMnemonic } from "../../wallet/chains.js";
import {
  getWalletAccounts,
  getWalletBalanceForChain,
  getWalletSummary,
  importWallet,
  initWallet,
  quoteWalletTransaction,
  sendWallet,
} from "../../wallet/service.js";
import {
  LOCAL_KEYSTORE_WALLET_CHAINS,
  WALLET_CHAINS,
  type WalletChain,
} from "../../wallet/types.js";
import { runCommandWithRuntime } from "../cli-utils.js";

const WALLET_CHAIN_SET = new Set<string>(WALLET_CHAINS);

type WalletOpts = {
  json?: boolean;
};

type WalletPassphraseOpts = {
  passphraseStdin?: boolean;
};

async function readStdin(maxBytes = 64 * 1024): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    total += buffer.length;
    if (total > maxBytes) {
      throw new Error("stdin input is too large");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readPassphrase(opts: WalletPassphraseOpts): Promise<string> {
  const fromEnv = process.env.GENESIS_WALLET_PASSPHRASE?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  if (opts.passphraseStdin) {
    const value = (await readStdin(16 * 1024)).trim();
    if (!value) {
      throw new Error("--passphrase-stdin received an empty passphrase");
    }
    return value;
  }
  throw new Error("Set GENESIS_WALLET_PASSPHRASE or pass --passphrase-stdin.");
}

function parseChain(value: unknown): WalletChain {
  const chain = typeof value === "string" ? value.trim() : "";
  if (!WALLET_CHAIN_SET.has(chain)) {
    throw new Error(`--chain must be one of ${WALLET_CHAINS.join(", ")}`);
  }
  return chain as WalletChain;
}

function writeMaybeJson(opts: WalletOpts, payload: unknown, text: () => void) {
  if (opts.json) {
    writeRuntimeJson(defaultRuntime, payload);
    return;
  }
  text();
}

function formatAccountLine(account: {
  id: string;
  chain: string;
  address: string;
  network?: string;
  derivationPath?: string;
}) {
  const network = account.network ? ` ${theme.muted(`(${account.network})`)}` : "";
  const derivation = account.derivationPath ? ` ${theme.muted(account.derivationPath)}` : "";
  return `${theme.command(account.chain)} ${account.address}${network}${derivation}`;
}

async function showWalletSummary(opts: WalletOpts) {
  const summary = await getWalletSummary();
  writeMaybeJson(opts, summary, () => {
    defaultRuntime.log(theme.heading("Wallet"));
    defaultRuntime.log(`Enabled: ${summary.enabled ? "yes" : "no"}`);
    defaultRuntime.log(`Keystore: ${summary.keystore.exists ? "present" : "missing"}`);
    if (summary.primaryAccount) {
      defaultRuntime.log(`Primary: ${summary.primaryAccount}`);
    }
    if (summary.accounts.length === 0) {
      defaultRuntime.log(theme.muted("No public wallet addresses found."));
    } else {
      for (const account of summary.accounts) {
        defaultRuntime.log(formatAccountLine(account));
      }
    }
    for (const warning of summary.warnings) {
      defaultRuntime.log(theme.warn(`Warning: ${warning}`));
    }
  });
}

export function registerWalletCommand(program: Command) {
  const wallet = program
    .command("wallet")
    .description("Manage the local encrypted wallet and show public addresses")
    .option("--json", "Output JSON instead of text", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, () => showWalletSummary(opts));
    });

  wallet
    .command("init")
    .description("Create a new encrypted local wallet")
    .option("--passphrase-stdin", "Read the wallet passphrase from stdin", false)
    .option("--overwrite", "Replace an existing wallet keystore", false)
    .option("--show-mnemonic", "Print the generated mnemonic once in human-readable output", false)
    .option("--json", "Output JSON instead of text", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        if (opts.json && opts.showMnemonic) {
          throw new Error("--show-mnemonic cannot be combined with --json.");
        }
        const passphrase = await readPassphrase(opts);
        const mnemonic = opts.showMnemonic ? generateWalletMnemonic() : undefined;
        const result = await initWallet({
          passphrase,
          mnemonic,
          overwrite: Boolean(opts.overwrite),
          chains: LOCAL_KEYSTORE_WALLET_CHAINS,
        });
        writeMaybeJson(opts, result.summary, () => {
          defaultRuntime.log(theme.success("Wallet initialized."));
          if (mnemonic) {
            defaultRuntime.log(theme.warn("Generated mnemonic, shown once:"));
            defaultRuntime.log(mnemonic);
          } else if (result.mnemonicGenerated) {
            defaultRuntime.log(
              theme.warn(
                "A new mnemonic was generated and encrypted locally. For recoverable funds, prefer `genesis wallet import --mnemonic-stdin` with your backed-up mnemonic.",
              ),
            );
          }
          for (const account of result.summary.accounts) {
            defaultRuntime.log(formatAccountLine(account));
          }
        });
      });
    });

  wallet
    .command("import")
    .description("Import a BIP39 mnemonic into the encrypted local wallet")
    .requiredOption("--mnemonic-stdin", "Read the mnemonic from stdin")
    .option("--overwrite", "Replace an existing wallet keystore", false)
    .option("--json", "Output JSON instead of text", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        const passphrase = await readPassphrase({});
        const mnemonic = await readStdin();
        const result = await importWallet({
          passphrase,
          mnemonic,
          overwrite: Boolean(opts.overwrite),
          chains: LOCAL_KEYSTORE_WALLET_CHAINS,
        });
        writeMaybeJson(opts, result.summary, () => {
          defaultRuntime.log(theme.success("Wallet imported."));
          for (const account of result.summary.accounts) {
            defaultRuntime.log(formatAccountLine(account));
          }
        });
      });
    });

  wallet
    .command("list")
    .description("List public wallet accounts")
    .option("--json", "Output JSON instead of text", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        const accounts = await getWalletAccounts();
        writeMaybeJson(opts, { accounts }, () => {
          for (const account of accounts) {
            defaultRuntime.log(formatAccountLine(account));
          }
        });
      });
    });

  wallet
    .command("address")
    .description("Show public wallet addresses")
    .option("--chain <chain>", `Filter by chain (${WALLET_CHAINS.join("|")})`)
    .option("--json", "Output JSON instead of text", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        const chain = opts.chain ? parseChain(opts.chain) : null;
        const accounts = (await getWalletAccounts()).filter((account) =>
          chain ? account.chain === chain : true,
        );
        writeMaybeJson(opts, { accounts }, () => {
          for (const account of accounts) {
            defaultRuntime.log(formatAccountLine(account));
          }
        });
      });
    });

  wallet
    .command("balance")
    .description("Fetch a wallet balance")
    .requiredOption("--chain <chain>", `Chain (${WALLET_CHAINS.join("|")})`)
    .option("--account <id>", "Wallet account id")
    .option("--json", "Output JSON instead of text", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        const balance = await getWalletBalanceForChain({
          chain: parseChain(opts.chain),
          accountId: opts.account,
        });
        writeMaybeJson(opts, balance, () => {
          defaultRuntime.log(
            `${balance.chain} ${balance.address}: ${balance.amount} ${balance.asset}`,
          );
        });
      });
    });

  wallet
    .command("quote")
    .description("Quote a native wallet transfer")
    .requiredOption("--chain <chain>", `Chain (${WALLET_CHAINS.join("|")})`)
    .requiredOption("--to <address>", "Destination address")
    .requiredOption("--amount <amount>", "Native asset amount")
    .option("--account <id>", "Wallet account id")
    .option("--json", "Output JSON instead of text", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        const quote = await quoteWalletTransaction({
          chain: parseChain(opts.chain),
          accountId: opts.account,
          to: opts.to,
          amount: opts.amount,
        });
        writeMaybeJson(opts, quote, () => {
          defaultRuntime.log(`${quote.amount} ${quote.asset}: ${quote.from} -> ${quote.to}`);
          if (quote.estimatedFee) {
            defaultRuntime.log(`Estimated fee: ${quote.estimatedFee} ${quote.asset}`);
          }
        });
      });
    });

  wallet
    .command("send")
    .description("Send a native wallet transfer")
    .requiredOption("--chain <chain>", `Chain (${WALLET_CHAINS.join("|")})`)
    .requiredOption("--to <address>", "Destination address")
    .requiredOption("--amount <amount>", "Native asset amount")
    .option("--account <id>", "Wallet account id")
    .option("--passphrase-stdin", "Read the wallet passphrase from stdin", false)
    .option("--yes", "Confirm and broadcast the transfer", false)
    .option("--json", "Output JSON instead of text", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        const passphrase = await readPassphrase(opts);
        const result = await sendWallet({
          chain: parseChain(opts.chain),
          accountId: opts.account,
          to: opts.to,
          amount: opts.amount,
          passphrase,
          guard: { yes: Boolean(opts.yes), allowEnv: process.env },
        });
        writeMaybeJson(opts, result, () => {
          defaultRuntime.log(theme.success(`Broadcast ${result.chain} transaction ${result.txId}`));
        });
      });
    });
}
