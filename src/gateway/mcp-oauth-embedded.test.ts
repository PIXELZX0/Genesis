import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cancelEmbeddedOAuth,
  type EmbeddedBrowserHandle,
  type EmbeddedLaunchArgs,
  embeddedSessionCount,
  inputEmbeddedOAuth,
  normalizeViewport,
  pollEmbeddedOAuth,
  resolveChromiumPath,
  setEmbeddedBrowserLauncher,
  startEmbeddedOAuth,
  teardownAllEmbeddedOAuth,
} from "./mcp-oauth-embedded.ts";

type FakeHandle = EmbeddedBrowserHandle & { closed: boolean; inputs: unknown[] };

function makeFakeLauncher(): {
  launcher: (args: EmbeddedLaunchArgs) => Promise<EmbeddedBrowserHandle>;
  last: () => { args: EmbeddedLaunchArgs; handle: FakeHandle } | null;
} {
  let captured: { args: EmbeddedLaunchArgs; handle: FakeHandle } | null = null;
  const launcher = async (args: EmbeddedLaunchArgs) => {
    const handle: FakeHandle = {
      closed: false,
      inputs: [],
      async screenshot() {
        return { dataBase64: "AAAA", w: args.viewport.w, h: args.viewport.h };
      },
      async input(ev) {
        this.inputs.push(ev);
      },
      async close() {
        this.closed = true;
      },
    };
    captured = { args, handle };
    return handle;
  };
  return { launcher, last: () => captured };
}

const baseStart = {
  connId: "conn-1",
  name: "acme",
  authorizeUrl: "https://issuer.example/authorize?x=1",
  oauthState: "state-abc",
  chromiumPath: "/usr/bin/chromium",
  redirectUriPrefix: "https://gw.example/mcp-oauth-callback.html",
  viewport: { w: 520, h: 720 },
};

afterEach(() => {
  teardownAllEmbeddedOAuth();
  setEmbeddedBrowserLauncher(null);
});

describe("normalizeViewport", () => {
  it("clamps and defaults", () => {
    expect(normalizeViewport()).toEqual({ w: 520, h: 720 });
    expect(normalizeViewport({ w: 10, h: 99999 })).toEqual({ w: 320, h: 1600 });
    expect(normalizeViewport({ w: 800, h: 600 })).toEqual({ w: 800, h: 600 });
  });
});

describe("resolveChromiumPath", () => {
  it("prefers an existing explicit path and honors env override", () => {
    // Use this test file itself as a stand-in for an existing executable path.
    const existing = fileURLToPath(import.meta.url);
    expect(resolveChromiumPath(existing)).toBe(existing);

    const prev = process.env.CHROME_PATH;
    process.env.CHROME_PATH = existing;
    // A non-existent configured path falls through to the env value.
    expect(resolveChromiumPath("/definitely/not/here")).toBe(existing);
    if (prev === undefined) {
      delete process.env.CHROME_PATH;
    } else {
      process.env.CHROME_PATH = prev;
    }
  });
});

describe("startEmbeddedOAuth", () => {
  it("launches, polls a frame, and completes via the injected token exchange", async () => {
    const fake = makeFakeLauncher();
    setEmbeddedBrowserLauncher(fake.launcher);
    const onComplete = vi.fn(async () => ({
      ok: true,
      providerName: "Acme",
      expiresAtMs: 123,
    }));

    const { sessionId } = await startEmbeddedOAuth({ ...baseStart, onComplete });
    expect(embeddedSessionCount()).toBe(1);

    const poll1 = await pollEmbeddedOAuth(sessionId);
    expect(poll1?.phase).toBe("interactive");
    expect(poll1?.frame?.dataBase64).toBe("AAAA");
    expect(poll1?.seq).toBe(1);

    // Drive the redirect the driver would have observed.
    const captured = fake.last();
    expect(captured).not.toBeNull();
    captured!.args.onRedirect({ code: "the-code", state: "state-abc" });
    await vi.waitFor(async () => {
      const p = await pollEmbeddedOAuth(sessionId);
      expect(p?.phase).toBe("done");
    });

    expect(onComplete).toHaveBeenCalledWith({
      name: "acme",
      state: "state-abc",
      code: "the-code",
    });
    const done = await pollEmbeddedOAuth(sessionId);
    expect(done?.providerName).toBe("Acme");
    expect(captured!.handle.closed).toBe(true);
  });

  it("rejects a redirect whose state does not match", async () => {
    const fake = makeFakeLauncher();
    setEmbeddedBrowserLauncher(fake.launcher);
    const onComplete = vi.fn(async () => ({ ok: true }));
    const { sessionId } = await startEmbeddedOAuth({ ...baseStart, onComplete });

    fake.last()!.args.onRedirect({ code: "c", state: "WRONG" });
    await vi.waitFor(async () => {
      const p = await pollEmbeddedOAuth(sessionId);
      expect(p?.phase).toBe("error");
    });
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("replaces a prior session for the same connection", async () => {
    const fake = makeFakeLauncher();
    setEmbeddedBrowserLauncher(fake.launcher);
    const onComplete = vi.fn(async () => ({ ok: true }));

    const first = await startEmbeddedOAuth({ ...baseStart, onComplete });
    await startEmbeddedOAuth({ ...baseStart, onComplete });
    expect(embeddedSessionCount()).toBe(1);
    expect(await pollEmbeddedOAuth(first.sessionId)).toBeNull();
  });

  it("relays input only while interactive and cancels cleanly", async () => {
    const fake = makeFakeLauncher();
    setEmbeddedBrowserLauncher(fake.launcher);
    const { sessionId } = await startEmbeddedOAuth({
      ...baseStart,
      onComplete: async () => ({ ok: true }),
    });

    const ok = await inputEmbeddedOAuth(sessionId, {
      kind: "mouse",
      action: "click",
      x: 10,
      y: 20,
    });
    expect(ok).toBe(true);
    expect(fake.last()!.handle.inputs).toHaveLength(1);

    expect(cancelEmbeddedOAuth(sessionId)).toBe(true);
    expect(embeddedSessionCount()).toBe(0);
    expect(fake.last()!.handle.closed).toBe(true);
    expect(await inputEmbeddedOAuth(sessionId, { kind: "key", action: "type", text: "x" })).toBe(
      false,
    );
  });
});
