import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import { formatRelativeTimestamp } from "../format.ts";
import { icons } from "../icons.ts";
import type { WalletBalance, WalletPublicAccount, WalletSummaryResult } from "../types.ts";

export type WalletProps = {
  connected: boolean;
  loading: boolean;
  balancesLoading: boolean;
  summary: WalletSummaryResult | null;
  error: string | null;
  lastUpdatedAt: number | null;
  onRefresh: () => void;
  onConfigure: () => void;
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

function copyAddress(address: string) {
  void navigator.clipboard?.writeText(address).catch(() => undefined);
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
          @click=${() => copyAddress(account.address)}
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

export function renderWallet(props: WalletProps) {
  return html` ${renderWalletStatus(props)} ${renderWalletAccounts(props)} `;
}
