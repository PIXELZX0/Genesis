---
summary: "CLI reference for `genesis wallet` local wallet addresses, balances, quotes, signing, and guarded sends"
read_when:
  - Managing local wallet public addresses
  - Letting an agent inspect wallet addresses or balances through CLI JSON
  - Reviewing wallet signing and send safety gates
title: "Wallet"
---

# `genesis wallet`

Use `genesis wallet` to manage a local encrypted wallet and expose a stable
machine-readable interface for agents.

Supported chains:

- `btc`: local BIP39/BIP84-derived Bitcoin address, Esplora balance/UTXO/broadcast
- `evm`: local BIP39-derived EVM addresses through EVM JSON-RPC URLs. Ethereum,
  Base, and Monad are enabled by default with public RPC endpoints.
- `sol`: local BIP39/SLIP-0010-derived Solana address through `@solana/web3.js`
- `trx`: local BIP39-derived TRON address through TronWeb
- `xmr`: read and transfer through `monero-wallet-rpc`; Genesis does not sign Monero locally

Security model:

- The encrypted keystore is stored under the Genesis credentials directory with
  owner-only file permissions.
- Public address metadata is readable while the keystore is locked.
- One BIP39 secret recovery phrase derives every local keystore chain account
  (`btc`, `evm`, `sol`, and `trx`) through that chain's configured derivation
  path. EVM accounts share the same derived address across configured EVM
  networks.
- Existing mnemonics, private keys, passphrases, and raw secret material are not
  returned by JSON output, Gateway RPC, or the Control UI.
- EVM message, digest, and raw transaction signing are CLI-only and return
  signatures or signed transaction bytes, never private keys.
- The Control UI can create a new recovery phrase or import/replace one through
  the admin-scoped `wallet.recoveryPhrase.set` method. A newly generated phrase
  is returned once so it can be backed up; imported or existing phrases are not
  echoed back.
- Send and broadcast flows stay in the CLI.

## Create or import

Create a new wallet:

```bash
printf '%s\n' "$GENESIS_WALLET_PASSPHRASE" | genesis wallet init --passphrase-stdin
```

Import a mnemonic:

```bash
export GENESIS_WALLET_PASSPHRASE='use-a-long-local-passphrase'
printf '%s\n' "$MNEMONIC" | genesis wallet import --mnemonic-stdin
```

Notes:

- `init` generates a new mnemonic and encrypts it locally.
- `--show-mnemonic` prints a generated mnemonic once in human-readable output
  and cannot be combined with `--json`.
- `import --mnemonic-stdin` reads the mnemonic from stdin and reads the
  passphrase from `GENESIS_WALLET_PASSPHRASE`.
- `--overwrite` replaces an existing keystore.

## Addresses and balances

Public addresses:

```bash
genesis wallet
genesis wallet list
genesis wallet address --chain evm
genesis wallet address --json
```

Balances:

```bash
genesis wallet balance --chain btc
genesis wallet balance --chain evm --account evm:base --json
```

Agents should prefer `--json` and treat the response as the stable automation
surface.

## Quote and send

Quote a native asset transfer:

```bash
genesis wallet quote --chain sol --to <address> --amount 0.1
genesis wallet quote --chain sol --to <address> --amount 0.1 --json
```

Broadcasting is intentionally harder. A send must pass all configured and
per-invocation guards:

- `wallet.spending.enabled: true`
- `--yes`
- wallet passphrase from `GENESIS_WALLET_PASSPHRASE` or `--passphrase-stdin`
- `GENESIS_WALLET_ALLOW_SPEND=1` unless `wallet.spending.requireAllowEnv` is disabled
- `wallet.spending.maxNativeAmount`, when configured

Example:

```bash
GENESIS_WALLET_ALLOW_SPEND=1 \
GENESIS_WALLET_PASSPHRASE='use-a-long-local-passphrase' \
genesis wallet send --chain trx --to <address> --amount 1 --yes
```

## Signing and raw transactions

The wallet can sign EVM payloads with a configured EVM account:

```bash
GENESIS_WALLET_PASSPHRASE='use-a-long-local-passphrase' \
genesis wallet sign-message --chain evm --account evm:base --message 'hello' --yes --json

GENESIS_WALLET_PASSPHRASE='use-a-long-local-passphrase' \
genesis wallet sign-digest --chain evm --digest 0x0000000000000000000000000000000000000000000000000000000000000001 --yes --json
```

`sign-message` uses the EVM personal-sign/EIP-191 message prefix. Use
`--message-hex` to sign exact message bytes. `sign-digest` signs the exact
32-byte digest and does not add a message prefix.

Raw transaction signing and broadcast use the same spending gates as `send`
because they can move funds or invoke contracts:

```bash
GENESIS_WALLET_ALLOW_SPEND=1 \
GENESIS_WALLET_PASSPHRASE='use-a-long-local-passphrase' \
genesis wallet sign-raw-transaction \
  --chain evm \
  --account evm:base \
  --tx-json '{"to":"0x0000000000000000000000000000000000000001","nonce":0,"gasLimit":"21000","gasPrice":"1","value":"1"}' \
  --yes \
  --json

GENESIS_WALLET_ALLOW_SPEND=1 \
GENESIS_WALLET_PASSPHRASE='use-a-long-local-passphrase' \
genesis wallet broadcast-raw \
  --chain evm \
  --account evm:base \
  --raw-transaction 0x... \
  --yes \
  --json
```

`sign-raw-transaction` accepts unsigned EVM transaction request fields such as
`to`, `from`, `nonce`, `gasLimit` or `gas`, `gasPrice`, `maxFeePerGas`,
`maxPriorityFeePerGas`, `value`, `data`, `chainId`, `type`, and `accessList`.
If `chainId` is omitted, Genesis fills the selected EVM network's chain id.
If `chainId` is present, it must match the selected account's network.
When `transaction.value` is present, `wallet.spending.maxNativeAmount` is
checked against that native asset value. Genesis does not decode arbitrary
contract calldata for token-level spend limits.

## Configuration

Minimal example:

```json5
{
  wallet: {
    enabled: true,
    networks: {
      btc: { network: "mainnet" },
      evm: {
        // Optional. Omit `rpcUrl` to use the built-in public RPC defaults for
        // ethereum, base, and monad. Override or disable individual EVM chains
        // under `chains`.
        chains: {
          ethereum: {
            rpcUrl: { source: "env", provider: "default", id: "ETH_RPC_URL" },
          },
          base: {
            rpcUrl: { source: "env", provider: "default", id: "BASE_RPC_URL" },
          },
          monad: {
            rpcUrl: { source: "env", provider: "default", id: "MONAD_RPC_URL" },
          },
        },
      },
      sol: { network: "mainnet-beta" },
      trx: {
        fullHost: "https://api.trongrid.io",
        apiKey: { source: "env", provider: "default", id: "TRONGRID_API_KEY" },
      },
      xmr: {
        walletRpcUrl: "http://127.0.0.1:18082/json_rpc",
        username: { source: "env", provider: "default", id: "MONERO_RPC_USER" },
        password: { source: "env", provider: "default", id: "MONERO_RPC_PASSWORD" },
      },
    },
    spending: {
      enabled: false,
      requireAllowEnv: true,
      maxNativeAmount: "0.1",
    },
  },
}
```

Secret-bearing wallet fields support SecretRef inputs where the config schema
marks them sensitive. See [Secrets Management](/gateway/secrets).

When `wallet.networks.evm.rpcUrl` is omitted and no legacy single-chain EVM
config is set, Genesis creates EVM accounts for `evm:ethereum`, `evm:base`, and
`evm:monad`. A legacy single-chain config for Ethereum, Base, or Monad also uses
that chain's public RPC when `rpcUrl` is omitted. These defaults are
rate-limited and are best for setup, address display, and low-volume balance
checks. For production or agentic send flows, configure private or secret-backed
endpoints under `wallet.networks.evm.chains`.

## Gateway and Control UI

The Gateway exposes read-only `wallet.summary` for operator clients with
`operator.read`. The Control UI Wallet tab calls that method and displays public
addresses, balance refresh results, warnings, and copy buttons.

The Control UI also supports admin-scoped recovery phrase management through
`wallet.recoveryPhrase.set`:

- `mode: "generate"` creates a new BIP39 phrase, encrypts it locally, derives
  all local chain accounts, and returns the generated phrase once.
- `mode: "import"` imports a BIP39 phrase, encrypts it locally, derives all
  local chain accounts, and does not return the phrase.
- `passphrase` is optional for the web/admin method; omit it to create or
  import a wallet without a passphrase.
- `overwrite: true` is required when replacing an existing keystore.

No Gateway or web method returns existing seed phrases, private keys, stored
passphrases, signatures, raw transaction signing, or a send/broadcast control.

## Related

- [Control UI](/web/control-ui)
- [Exec tool](/tools/exec)
- [Secrets management](/gateway/secrets)
