import type { Command } from "commander";
import { defaultRuntime, writeRuntimeJson } from "../../runtime.js";
import { theme } from "../../terminal/theme.js";
import { generateWalletMnemonic } from "../../wallet/chains.js";
import {
  broadcastWalletRawTransaction,
  getWalletAccounts,
  getWalletBalanceForChain,
  getWalletSummary,
  importWallet,
  initWallet,
  quoteWalletTransaction,
  sendWallet,
  signWalletDigest,
  signWalletMessage,
  signWalletRawTransaction,
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

async function readPassphraseWithDataStdin(
  opts: WalletPassphraseOpts,
  dataUsesStdin: boolean,
  dataFlag: string,
): Promise<string> {
  const fromEnv = process.env.GENESIS_WALLET_PASSPHRASE?.trim();
  if (dataUsesStdin && opts.passphraseStdin && !fromEnv) {
    throw new Error(
      `${dataFlag} and --passphrase-stdin cannot both read stdin; set GENESIS_WALLET_PASSPHRASE instead.`,
    );
  }
  return readPassphrase({ passphraseStdin: dataUsesStdin ? false : opts.passphraseStdin });
}

function parseChain(value: unknown): WalletChain {
  const chain = typeof value === "string" ? value.trim() : "";
  if (!WALLET_CHAIN_SET.has(chain)) {
    throw new Error(`--chain must be one of ${WALLET_CHAINS.join(", ")}`);
  }
  return chain as WalletChain;
}

function parseJsonObject(value: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(`${label} must be valid JSON.`, { cause: error });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

async function readRequiredOptionOrStdin(params: {
  value: unknown;
  useStdin: boolean;
  valueFlag: string;
  stdinFlag: string;
  label: string;
  maxBytes?: number;
}): Promise<string> {
  const direct = typeof params.value === "string" ? params.value : undefined;
  if (direct !== undefined && params.useStdin) {
    throw new Error(`${params.valueFlag} cannot be combined with ${params.stdinFlag}.`);
  }
  if (params.useStdin) {
    const value = (await readStdin(params.maxBytes)).trim();
    if (!value) {
      throw new Error(`${params.stdinFlag} received empty ${params.label}.`);
    }
    return value;
  }
  if (direct === undefined) {
    throw new Error(`Provide ${params.valueFlag} or ${params.stdinFlag}.`);
  }
  return direct;
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
    .command("sign-message")
    .description("Sign an EVM personal-sign message")
    .requiredOption("--chain <chain>", `Chain (${WALLET_CHAINS.join("|")})`)
    .option("--account <id>", "Wallet account id")
    .option("--message <text>", "UTF-8 message to sign")
    .option("--message-hex <hex>", "0x-prefixed message bytes to sign")
    .option("--passphrase-stdin", "Read the wallet passphrase from stdin", false)
    .option("--yes", "Confirm the signing request", false)
    .option("--json", "Output JSON instead of text", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        const passphrase = await readPassphrase(opts);
        const result = await signWalletMessage({
          chain: parseChain(opts.chain),
          accountId: opts.account,
          message: opts.message,
          messageHex: opts.messageHex,
          passphrase,
          guard: { yes: Boolean(opts.yes) },
        });
        writeMaybeJson(opts, result, () => {
          defaultRuntime.log(result.signature);
        });
      });
    });

  wallet
    .command("sign-digest")
    .description("Sign a 32-byte EVM digest without message prefixing")
    .requiredOption("--chain <chain>", `Chain (${WALLET_CHAINS.join("|")})`)
    .requiredOption("--digest <hex>", "0x-prefixed 32-byte digest")
    .option("--account <id>", "Wallet account id")
    .option("--passphrase-stdin", "Read the wallet passphrase from stdin", false)
    .option("--yes", "Confirm the signing request", false)
    .option("--json", "Output JSON instead of text", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        const passphrase = await readPassphrase(opts);
        const result = await signWalletDigest({
          chain: parseChain(opts.chain),
          accountId: opts.account,
          digest: opts.digest,
          passphrase,
          guard: { yes: Boolean(opts.yes) },
        });
        writeMaybeJson(opts, result, () => {
          defaultRuntime.log(result.signature);
        });
      });
    });

  wallet
    .command("sign-raw-transaction")
    .description("Sign an EVM raw transaction JSON object without broadcasting")
    .requiredOption("--chain <chain>", `Chain (${WALLET_CHAINS.join("|")})`)
    .option("--account <id>", "Wallet account id")
    .option("--tx-json <json>", "Unsigned EVM transaction request JSON")
    .option("--tx-json-stdin", "Read unsigned EVM transaction request JSON from stdin", false)
    .option("--passphrase-stdin", "Read the wallet passphrase from stdin", false)
    .option("--yes", "Confirm and sign the raw transaction", false)
    .option("--json", "Output JSON instead of text", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        const txJsonStdin = Boolean(opts.txJsonStdin);
        const passphrase = await readPassphraseWithDataStdin(opts, txJsonStdin, "--tx-json-stdin");
        const txJson = await readRequiredOptionOrStdin({
          value: opts.txJson,
          useStdin: txJsonStdin,
          valueFlag: "--tx-json",
          stdinFlag: "--tx-json-stdin",
          label: "transaction JSON",
          maxBytes: 256 * 1024,
        });
        const result = await signWalletRawTransaction({
          chain: parseChain(opts.chain),
          accountId: opts.account,
          transaction: parseJsonObject(txJson, "--tx-json"),
          passphrase,
          guard: { yes: Boolean(opts.yes), allowEnv: process.env },
        });
        writeMaybeJson(opts, result, () => {
          defaultRuntime.log(result.rawTransaction);
          if (result.txId) {
            defaultRuntime.log(theme.muted(`txId: ${result.txId}`));
          }
        });
      });
    });

  wallet
    .command("broadcast-raw")
    .description("Broadcast a signed EVM raw transaction")
    .requiredOption("--chain <chain>", `Chain (${WALLET_CHAINS.join("|")})`)
    .option("--account <id>", "Wallet account id")
    .option("--raw-transaction <hex>", "Signed 0x-prefixed raw transaction")
    .option("--raw-transaction-stdin", "Read signed raw transaction hex from stdin", false)
    .option("--passphrase-stdin", "Read the wallet passphrase from stdin", false)
    .option("--yes", "Confirm and broadcast the raw transaction", false)
    .option("--json", "Output JSON instead of text", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        const rawTransactionStdin = Boolean(opts.rawTransactionStdin);
        const passphrase = await readPassphraseWithDataStdin(
          opts,
          rawTransactionStdin,
          "--raw-transaction-stdin",
        );
        const rawTransaction = await readRequiredOptionOrStdin({
          value: opts.rawTransaction,
          useStdin: rawTransactionStdin,
          valueFlag: "--raw-transaction",
          stdinFlag: "--raw-transaction-stdin",
          label: "raw transaction",
          maxBytes: 512 * 1024,
        });
        const result = await broadcastWalletRawTransaction({
          chain: parseChain(opts.chain),
          accountId: opts.account,
          rawTransaction,
          passphrase,
          guard: { yes: Boolean(opts.yes), allowEnv: process.env },
        });
        writeMaybeJson(opts, result, () => {
          defaultRuntime.log(theme.success(`Broadcast ${result.chain} transaction ${result.txId}`));
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
