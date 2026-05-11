import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../i18n/index.ts";
import type { WalletRecoveryPhraseInput, WalletRecoveryPhraseMode } from "../controllers/wallet.ts";
import { formatRelativeTimestamp } from "../format.ts";
import { icons } from "../icons.ts";
import type {
  WalletBalance,
  WalletNftCollection,
  WalletPublicAccount,
  WalletSummaryResult,
  WalletTokenBalance,
} from "../types.ts";

export type WalletProps = {
  connected: boolean;
  loading: boolean;
  balancesLoading: boolean;
  summary: WalletSummaryResult | null;
  error: string | null;
  lastUpdatedAt: number | null;
  recoveryPhraseMode: WalletRecoveryPhraseMode;
  recoveryPhraseBusy: boolean;
  recoveryPhraseError: string | null;
  recoveryPhraseGeneratedMnemonic: string | null;
  recoveryPhraseStatus: "generated" | "imported" | null;
  onRefresh: () => void;
  onConfigure: () => void;
  onRecoveryPhraseModeChange: (mode: WalletRecoveryPhraseMode) => void;
  onManageRecoveryPhrase: (input: WalletRecoveryPhraseInput) => Promise<boolean> | boolean;
};

function walletChainLabel(chain: WalletPublicAccount["chain"]): string {
  switch (chain) {
    case "btc":
      return "BTC";
    case "evm":
      return "EVM";
    case "sol":
      return "SOL";
    case "trx":
      return "TRX";
    case "xmr":
      return "XMR";
  }
  const exhaustiveChain: never = chain;
  return exhaustiveChain;
}

function accountBalance(
  account: WalletPublicAccount,
  balances: readonly WalletBalance[] | undefined,
): WalletBalance | null {
  return (
    balances?.find(
      (balance) => balance.chain === account.chain && balance.accountId === account.id,
    ) ?? null
  );
}

function copyText(value: string) {
  void navigator.clipboard?.writeText(value).catch(() => undefined);
}

function renderStatusCard(label: string, value: unknown, valueClass = "") {
  return html`
    <div class="stat">
      <div class="stat-label">${label}</div>
      <div class="stat-value ${valueClass}" style="overflow-wrap: anywhere;">${value}</div>
    </div>
  `;
}

function renderWalletStatus(props: WalletProps) {
  const summary = props.summary;
  const keystoreLabel = summary?.keystore.exists
    ? summary.keystore.locked
      ? t("wallet.status.locked")
      : t("wallet.status.available")
    : t("wallet.status.missing");
  const lastUpdated = props.lastUpdatedAt
    ? t("wallet.lastUpdated", { time: formatRelativeTimestamp(props.lastUpdatedAt) })
    : null;

  return html`
    <section class="card">
      <div class="row" style="justify-content: space-between; align-items: flex-start;">
        <div>
          <div class="card-title">${t("wallet.status.title")}</div>
          <div class="card-sub">
            ${props.summary ? t("wallet.subtitle") : t("wallet.accounts.subtitle")}
            ${lastUpdated ? html`<span> ${lastUpdated}</span>` : nothing}
          </div>
        </div>
        <div class="row" style="gap: 8px; flex-wrap: wrap; justify-content: flex-end;">
          <button class="btn" @click=${props.onConfigure}>${t("wallet.configure")}</button>
          <button
            class="btn primary"
            ?disabled=${props.loading || !props.connected}
            @click=${props.onRefresh}
          >
            ${props.loading || props.balancesLoading
              ? t("common.refreshing")
              : t("wallet.refreshBalances")}
          </button>
        </div>
      </div>
      ${props.error
        ? html`<div class="callout danger" style="margin-top: 12px;">${props.error}</div>`
        : nothing}
      <div class="stat-grid" style="margin-top: 16px;">
        ${renderStatusCard(
          t("wallet.status.enabled"),
          summary?.enabled ? t("common.yes") : t("common.no"),
          summary?.enabled ? "ok" : "warn",
        )}
        ${renderStatusCard(
          t("wallet.status.keystore"),
          keystoreLabel,
          summary?.keystore.exists ? "ok" : "warn",
        )}
        ${renderStatusCard(t("wallet.status.accounts"), String(summary?.accounts.length ?? 0))}
        ${renderStatusCard(
          t("wallet.status.primary"),
          summary?.primaryAccount ?? t("wallet.status.notSet"),
        )}
      </div>
      ${summary?.warnings.length
        ? html`
            <div class="callout" style="margin-top: 16px;">
              <strong>${t("wallet.warnings.title")}</strong>
              <div style="margin-top: 8px;">
                ${summary.warnings.map((warning) => html`<div>${warning}</div>`)}
              </div>
            </div>
          `
        : nothing}
    </section>
  `;
}

function renderAccount(account: WalletPublicAccount, props: WalletProps) {
  const balance = accountBalance(account, props.summary?.balances);
  const isPrimary = props.summary?.primaryAccount === account.id;
  const balanceText = props.balancesLoading
    ? t("common.loading")
    : balance
      ? `${balance.amount} ${balance.asset}`
      : props.summary?.balances
        ? t("wallet.accounts.balanceUnavailable")
        : t("common.na");
  return html`
    <div class="list-item">
      <div class="list-main">
        <div class="list-title">
          ${walletChainLabel(account.chain)}
          ${isPrimary
            ? html`<span class="chip chip-ok">${t("wallet.accounts.primary")}</span>`
            : nothing}
        </div>
        <div class="list-sub">
          ${t("wallet.accounts.accountId")}: <span class="mono">${account.id}</span>
          ${account.network
            ? html` | ${t("wallet.accounts.network")}: ${account.network}`
            : nothing}
        </div>
        <div
          class="mono"
          title=${account.address}
          style="margin-top: 8px; font-size: 12px; overflow-wrap: anywhere;"
        >
          ${account.address}
        </div>
        ${account.derivationPath
          ? html`
              <div class="chip-row" style="margin-top: 10px;">
                <span class="chip"
                  >${t("wallet.accounts.derivation")}: ${account.derivationPath}</span
                >
              </div>
            `
          : nothing}
      </div>
      <div class="list-meta">
        <div>
          <div class="stat-label">${t("wallet.accounts.balance")}</div>
          <div class="mono" style="margin-top: 6px;">${balanceText}</div>
        </div>
        <button
          class="btn btn--icon"
          title=${t("wallet.accounts.copyAddress")}
          aria-label=${t("wallet.accounts.copyAddress")}
          @click=${() => copyText(account.address)}
        >
          ${icons.copy}
        </button>
      </div>
    </div>
  `;
}

function renderWalletAccounts(props: WalletProps) {
  const summary = props.summary;
  const accounts = summary?.accounts ?? [];
  const emptyText = summary?.keystore.exists
    ? t("wallet.accounts.emptyNoAccounts")
    : t("wallet.accounts.emptyMissing");
  return html`
    <section class="card">
      <div class="card-title">${t("wallet.accounts.title")}</div>
      <div class="card-sub">${t("wallet.accounts.subtitle")}</div>
      <div class="list" style="margin-top: 16px;">
        ${accounts.length === 0
          ? html`<div class="callout">${props.loading ? t("common.loading") : emptyText}</div>`
          : accounts.map((account) => renderAccount(account, props))}
      </div>
    </section>
  `;
}

function renderToken(token: WalletTokenBalance) {
  return html`
    <div class="list-item">
      <div class="list-main">
        <div class="list-title">
          ${token.asset} ${token.name ? html`<span class="chip">${token.name}</span>` : nothing}
        </div>
        <div class="list-sub">
          ${t("wallet.accounts.accountId")}: <span class="mono">${token.accountId}</span>
          ${token.network ? html` | ${t("wallet.accounts.network")}: ${token.network}` : nothing}
        </div>
        <div
          class="mono"
          title=${token.contractAddress}
          style="margin-top: 8px; font-size: 12px; overflow-wrap: anywhere;"
        >
          ${token.contractAddress}
        </div>
      </div>
      <div class="list-meta">
        <div>
          <div class="stat-label">${t("wallet.tokens.balance")}</div>
          <div class="mono" style="margin-top: 6px;">${token.amount} ${token.asset}</div>
        </div>
        <button
          class="btn btn--icon"
          title=${t("wallet.tokens.copyContract")}
          aria-label=${t("wallet.tokens.copyContract")}
          @click=${() => copyText(token.contractAddress)}
        >
          ${icons.copy}
        </button>
      </div>
    </div>
  `;
}

function renderWalletTokens(props: WalletProps) {
  const tokens = props.summary?.tokens;
  const loadingText = props.balancesLoading ? t("common.loading") : null;
  const emptyText =
    tokens === undefined ? t("wallet.tokens.refreshHint") : t("wallet.tokens.empty");
  return html`
    <section class="card">
      <div class="card-title">${t("wallet.tokens.title")}</div>
      <div class="card-sub">${t("wallet.tokens.subtitle")}</div>
      <div class="list" style="margin-top: 16px;">
        ${loadingText
          ? html`<div class="callout">${loadingText}</div>`
          : tokens && tokens.length > 0
            ? tokens.map(renderToken)
            : html`<div class="callout">${emptyText}</div>`}
      </div>
    </section>
  `;
}

function nftCollectionLabel(collection: WalletNftCollection): string {
  return collection.name ?? collection.symbol ?? collection.collectionId;
}

function renderNftCollection(collection: WalletNftCollection) {
  const tokenText =
    collection.tokens.length === 0
      ? t("wallet.nfts.noTrackedTokens")
      : collection.tokens
          .map((token) => `#${token.tokenId}${token.amount ? ` x${token.amount}` : ""}`)
          .join(", ");
  return html`
    <div class="list-item">
      <div class="list-main">
        <div class="list-title">
          ${nftCollectionLabel(collection)}
          <span class="chip">${collection.standard.toUpperCase()}</span>
        </div>
        <div class="list-sub">
          ${t("wallet.accounts.accountId")}: <span class="mono">${collection.accountId}</span>
          ${collection.network
            ? html` | ${t("wallet.accounts.network")}: ${collection.network}`
            : nothing}
        </div>
        <div
          class="mono"
          title=${collection.contractAddress}
          style="margin-top: 8px; font-size: 12px; overflow-wrap: anywhere;"
        >
          ${collection.contractAddress}
        </div>
        <div class="chip-row" style="margin-top: 10px;">
          <span class="chip">${t("wallet.nfts.tokens")}: ${tokenText}</span>
        </div>
      </div>
      <div class="list-meta">
        <div>
          <div class="stat-label">${t("wallet.nfts.balance")}</div>
          <div class="mono" style="margin-top: 6px;">${collection.balance ?? t("common.na")}</div>
        </div>
        <button
          class="btn btn--icon"
          title=${t("wallet.nfts.copyContract")}
          aria-label=${t("wallet.nfts.copyContract")}
          @click=${() => copyText(collection.contractAddress)}
        >
          ${icons.copy}
        </button>
      </div>
    </div>
  `;
}

function renderWalletNfts(props: WalletProps) {
  const nfts = props.summary?.nfts;
  const loadingText = props.balancesLoading ? t("common.loading") : null;
  const emptyText = nfts === undefined ? t("wallet.nfts.refreshHint") : t("wallet.nfts.empty");
  return html`
    <section class="card">
      <div class="card-title">${t("wallet.nfts.title")}</div>
      <div class="card-sub">${t("wallet.nfts.subtitle")}</div>
      <div class="list" style="margin-top: 16px;">
        ${loadingText
          ? html`<div class="callout">${loadingText}</div>`
          : nfts && nfts.length > 0
            ? nfts.map(renderNftCollection)
            : html`<div class="callout">${emptyText}</div>`}
      </div>
    </section>
  `;
}

function formValue(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === "string" ? value : "";
}

async function handleRecoveryPhraseSubmit(event: SubmitEvent, props: WalletProps) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!(form instanceof HTMLFormElement)) {
    return;
  }
  const data = new FormData(form);
  const ok = await props.onManageRecoveryPhrase({
    mode: props.recoveryPhraseMode,
    mnemonic: formValue(data, "mnemonic"),
    passphrase: formValue(data, "passphrase"),
    confirmPassphrase: formValue(data, "confirmPassphrase"),
    overwrite: data.get("overwrite") === "on",
  });
  if (ok) {
    form.reset();
  }
}

function renderRecoveryPhraseModeButton(
  props: WalletProps,
  mode: WalletRecoveryPhraseMode,
  icon: TemplateResult,
  label: string,
) {
  const active = props.recoveryPhraseMode === mode;
  return html`
    <button
      type="button"
      class="config-mode-toggle__btn ${active ? "active" : ""}"
      aria-pressed=${active ? "true" : "false"}
      @click=${() => props.onRecoveryPhraseModeChange(mode)}
    >
      ${icon} ${label}
    </button>
  `;
}

function renderGeneratedRecoveryPhrase(props: WalletProps) {
  const phrase = props.recoveryPhraseGeneratedMnemonic;
  if (!phrase) {
    return nothing;
  }
  return html`
    <div class="callout success" style="margin-top: 14px;">
      <div class="row" style="justify-content: space-between; align-items: flex-start;">
        <div>
          <strong>${t("wallet.recoveryPhrase.generatedTitle")}</strong>
          <div
            class="mono"
            style="margin-top: 10px; overflow-wrap: anywhere; color: var(--text-strong);"
          >
            ${phrase}
          </div>
        </div>
        <button
          class="btn btn--icon"
          title=${t("wallet.recoveryPhrase.copyGenerated")}
          aria-label=${t("wallet.recoveryPhrase.copyGenerated")}
          @click=${() => copyText(phrase)}
        >
          ${icons.copy}
        </button>
      </div>
    </div>
  `;
}

function renderRecoveryPhraseManager(props: WalletProps) {
  const isImport = props.recoveryPhraseMode === "import";
  const successText =
    props.recoveryPhraseStatus === "generated"
      ? t("wallet.recoveryPhrase.successGenerated")
      : props.recoveryPhraseStatus === "imported"
        ? t("wallet.recoveryPhrase.successImported")
        : null;
  return html`
    <section class="card">
      <div class="card-title">${t("wallet.recoveryPhrase.title")}</div>
      <div class="card-sub">${t("wallet.recoveryPhrase.subtitle")}</div>
      <div class="callout info" style="margin-top: 14px;">${t("wallet.recoveryPhrase.safety")}</div>
      ${renderGeneratedRecoveryPhrase(props)}
      ${successText && !props.recoveryPhraseGeneratedMnemonic
        ? html`<div class="callout success" style="margin-top: 14px;">${successText}</div>`
        : nothing}
      ${props.recoveryPhraseError
        ? html`<div class="callout danger" style="margin-top: 14px;">
            ${props.recoveryPhraseError}
          </div>`
        : nothing}
      <form
        style="display: grid; gap: 14px; margin-top: 16px;"
        @submit=${(event: SubmitEvent) => void handleRecoveryPhraseSubmit(event, props)}
      >
        <div
          class="config-mode-toggle wallet-recovery-mode-toggle"
          role="group"
          aria-label=${t("wallet.recoveryPhrase.mode")}
        >
          ${renderRecoveryPhraseModeButton(
            props,
            "generate",
            icons.spark,
            t("wallet.recoveryPhrase.generate"),
          )}
          ${renderRecoveryPhraseModeButton(
            props,
            "import",
            icons.download,
            t("wallet.recoveryPhrase.import"),
          )}
        </div>
        ${isImport
          ? html`
              <label class="field full">
                <span>${t("wallet.recoveryPhrase.phraseLabel")}</span>
                <textarea
                  name="mnemonic"
                  autocomplete="off"
                  spellcheck="false"
                  placeholder=${t("wallet.recoveryPhrase.phrasePlaceholder")}
                  ?disabled=${props.recoveryPhraseBusy}
                  required
                ></textarea>
              </label>
            `
          : nothing}
        <div class="stat-grid">
          <label class="field">
            <span>${t("wallet.recoveryPhrase.passphraseOptional")}</span>
            <input
              name="passphrase"
              type="password"
              autocomplete="new-password"
              ?disabled=${props.recoveryPhraseBusy}
            />
          </label>
          ${isImport
            ? nothing
            : html`
                <label class="field">
                  <span>${t("wallet.recoveryPhrase.confirmPassphraseOptional")}</span>
                  <input
                    name="confirmPassphrase"
                    type="password"
                    autocomplete="new-password"
                    ?disabled=${props.recoveryPhraseBusy}
                  />
                </label>
              `}
        </div>
        <label class="field-inline checkbox">
          <input name="overwrite" type="checkbox" ?disabled=${props.recoveryPhraseBusy} />
          <span>${t("wallet.recoveryPhrase.overwrite")}</span>
        </label>
        <div class="row" style="justify-content: flex-end; flex-wrap: wrap;">
          <button
            class="btn primary"
            type="submit"
            ?disabled=${props.recoveryPhraseBusy || !props.connected}
          >
            ${props.recoveryPhraseBusy
              ? t("common.saving")
              : isImport
                ? t("wallet.recoveryPhrase.importAction")
                : t("wallet.recoveryPhrase.generateAction")}
          </button>
        </div>
      </form>
    </section>
  `;
}

export function renderWallet(props: WalletProps) {
  return html`
    ${renderWalletStatus(props)} ${renderRecoveryPhraseManager(props)}
    ${renderWalletAccounts(props)} ${renderWalletTokens(props)} ${renderWalletNfts(props)}
  `;
}
