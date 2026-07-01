/**
 * Lazy runtime boundary for the embedded (server-side headless-browser) MCP
 * OAuth flow. Everything that touches `puppeteer-core` lives here so the module
 * is only ever imported dynamically — the dependency is optional and absent
 * gateways (mobile-node, mac-app builds without a Chromium) never pay for it.
 *
 * The registry in `mcp-oauth-embedded.ts` speaks only to the small
 * `EmbeddedBrowserHandle` contract defined there, so no `puppeteer-core` types
 * leak into the rest of the gateway.
 */
import type {
  EmbeddedBrowserHandle,
  EmbeddedInputEvent,
  EmbeddedLaunchArgs,
} from "./mcp-oauth-embedded.js";

/* ────────────────────  minimal puppeteer-core surface  ──────────────────── */
// We intentionally model only the tiny slice of the API we use, so the optional
// dependency can be absent at typecheck time (resolved via a runtime specifier).

type PptrMouseButton = "left" | "right" | "middle";

interface PptrMouse {
  move(x: number, y: number): Promise<void>;
  down(opts?: { button?: PptrMouseButton }): Promise<void>;
  up(opts?: { button?: PptrMouseButton }): Promise<void>;
  click(x: number, y: number, opts?: { button?: PptrMouseButton }): Promise<void>;
  wheel(opts: { deltaX: number; deltaY: number }): Promise<void>;
}

interface PptrKeyboard {
  type(text: string): Promise<void>;
  press(key: string): Promise<void>;
}

interface PptrPage {
  setViewport(opts: { width: number; height: number }): Promise<void>;
  goto(url: string, opts?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  url(): string;
  screenshot(opts: { type: "jpeg"; quality?: number; encoding: "base64" }): Promise<string>;
  on(event: "framenavigated", handler: (frame: PptrFrame) => void): void;
  mouse: PptrMouse;
  keyboard: PptrKeyboard;
}

interface PptrFrame {
  url(): string;
}

interface PptrBrowser {
  newPage(): Promise<PptrPage>;
  close(): Promise<void>;
  on(event: "disconnected", handler: () => void): void;
}

interface PuppeteerCoreModule {
  launch(opts: {
    executablePath: string;
    headless: boolean | "new";
    args?: string[];
    defaultViewport?: { width: number; height: number } | null;
  }): Promise<PptrBrowser>;
}

/** Whether `puppeteer-core` can be imported in this gateway runtime. */
export async function puppeteerLoadable(): Promise<boolean> {
  try {
    await loadPuppeteer();
    return true;
  } catch {
    return false;
  }
}

async function loadPuppeteer(): Promise<PuppeteerCoreModule> {
  // Runtime-computed specifier: keeps `puppeteer-core` out of the static module
  // graph so typecheck and bundling do not require the optional dependency.
  const specifier = "puppeteer-core";
  const mod = (await import(specifier)) as unknown as
    | PuppeteerCoreModule
    | { default: PuppeteerCoreModule };
  return "launch" in mod ? mod : mod.default;
}

/* ────────────────────────────  browser driver  ─────────────────────────── */

function applyInput(page: PptrPage, ev: EmbeddedInputEvent): Promise<void> {
  switch (ev.kind) {
    case "mouse": {
      const button = ev.button ?? "left";
      switch (ev.action) {
        case "move":
          return page.mouse.move(ev.x, ev.y);
        case "down":
          return page.mouse.move(ev.x, ev.y).then(() => page.mouse.down({ button }));
        case "up":
          return page.mouse.up({ button });
        case "click":
          return page.mouse.click(ev.x, ev.y, { button });
      }
      return Promise.resolve();
    }
    case "wheel":
      return page.mouse
        .move(ev.x, ev.y)
        .then(() => page.mouse.wheel({ deltaX: ev.deltaX, deltaY: ev.deltaY }));
    case "key":
      if (ev.action === "type" && typeof ev.text === "string") {
        return page.keyboard.type(ev.text);
      }
      if (ev.action === "press" && typeof ev.key === "string") {
        return page.keyboard.press(ev.key);
      }
      return Promise.resolve();
    default:
      return Promise.resolve();
  }
}

/**
 * Launch a headless Chromium, navigate to `authorizeUrl`, and resolve a handle
 * the registry drives. When the page navigates to `redirectUriPrefix` we parse
 * `code`/`state`, invoke `onRedirect`, and abort further navigation (the gateway
 * already holds the authorization code — the callback HTML need not render).
 */
export async function launchEmbeddedBrowser(
  args: EmbeddedLaunchArgs,
): Promise<EmbeddedBrowserHandle> {
  const puppeteer = await loadPuppeteer();
  const browser = await puppeteer.launch({
    executablePath: args.chromiumPath,
    headless: "new",
    // Ephemeral profile: cookies/credentials never persist across flows.
    args: [
      `--user-data-dir=${args.userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
    ],
    defaultViewport: { width: args.viewport.w, height: args.viewport.h },
  });

  let redirectHandled = false;
  const handleUrl = (url: string): void => {
    if (redirectHandled || !url.startsWith(args.redirectUriPrefix)) {
      return;
    }
    redirectHandled = true;
    try {
      const parsed = new URL(url);
      const error = parsed.searchParams.get("error") ?? undefined;
      const code = parsed.searchParams.get("code") ?? undefined;
      const state = parsed.searchParams.get("state") ?? undefined;
      args.onRedirect({ code, state, error });
    } catch {
      args.onRedirect({ error: "invalid_redirect_url" });
    }
  };

  const page = await browser.newPage();
  page.on("framenavigated", (frame) => handleUrl(frame.url()));
  browser.on("disconnected", () => args.onClosed?.());

  // Navigate; ignore navigation-abort rejections (redirect capture aborts nav).
  void page
    .goto(args.authorizeUrl, { waitUntil: "domcontentloaded", timeout: 60_000 })
    .catch(() => {
      // Non-fatal: the authorize page may 3xx immediately to the redirect URI.
      handleUrl(page.url());
    });

  return {
    async screenshot() {
      try {
        const dataBase64 = await page.screenshot({ type: "jpeg", quality: 60, encoding: "base64" });
        return { dataBase64, w: args.viewport.w, h: args.viewport.h };
      } catch {
        return null;
      }
    },
    async input(ev) {
      await applyInput(page, ev);
    },
    async close() {
      await browser.close().catch(() => {});
    },
  };
}
