import { html } from "lit";
import { t } from "../../i18n/index.ts";
import { renderTab } from "../app-render.helpers.ts";
import type { AppViewState } from "../app-view-state.ts";
import { icons } from "../icons.ts";

const PRIMARY_TABS = ["overview", "agents", "chat", "channels"] as const;

/**
 * Floating bottom tab bar shown only on phone-width viewports (CSS-gated,
 * see .mobile-tab-bar in layout.mobile.css). Reuses renderTab() so primary
 * items get the same click/session-switch semantics as the sidebar; "More"
 * opens the existing nav drawer instead of a dedicated tab.
 */
export function renderMobileTabBar(state: AppViewState) {
  const isMoreActive = !PRIMARY_TABS.includes(state.tab as (typeof PRIMARY_TABS)[number]);
  return html`
    <nav class="mobile-tab-bar" aria-label="${t("nav.more")}">
      ${PRIMARY_TABS.map(
        (tab) =>
          html`<div
            class="mobile-tab-bar__item"
            @click=${() => {
              state.navDrawerOpen = false;
            }}
          >
            ${renderTab(state, tab)}
          </div>`,
      )}
      <button
        type="button"
        class="mobile-tab-bar__item mobile-tab-bar__more nav-item ${isMoreActive &&
        state.navDrawerOpen
          ? "nav-item--active"
          : ""}"
        aria-expanded=${state.navDrawerOpen}
        @click=${() => {
          state.navDrawerOpen = !state.navDrawerOpen;
        }}
      >
        <span class="nav-item__icon" aria-hidden="true">${icons.menu}</span>
        <span class="nav-item__text">${t("nav.more")}</span>
      </button>
    </nav>
  `;
}
