import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteChannelAccount,
  restartChannel,
  waitWhatsAppLogin,
  type ChannelsState,
} from "./channels.ts";

function createState(): ChannelsState {
  return {
    client: {
      request: vi.fn(),
    } as never,
    connected: true,
    channelsLoading: false,
    channelsSnapshot: null,
    channelsError: null,
    channelsLastSuccess: null,
    whatsappLoginMessage: null,
    whatsappLoginQrDataUrl: "data:image/png;base64,current-qr",
    whatsappLoginConnected: false,
    whatsappBusy: false,
    channelRestartingKey: null,
    channelDeletingKey: null,
  };
}

describe("channels controller WhatsApp wait", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes the currently displayed QR and replaces it when the login QR rotates", async () => {
    const state = createState();
    const request = vi.mocked(state.client!.request);
    request.mockResolvedValueOnce({
      connected: false,
      message: "QR refreshed. Scan the latest code in WhatsApp → Linked Devices.",
      qrDataUrl: "data:image/png;base64,next-qr",
    });

    await waitWhatsAppLogin(state);

    expect(request).toHaveBeenCalledWith("web.login.wait", {
      timeoutMs: 120000,
      currentQrDataUrl: "data:image/png;base64,current-qr",
    });
    expect(state.whatsappLoginMessage).toBe(
      "QR refreshed. Scan the latest code in WhatsApp → Linked Devices.",
    );
    expect(state.whatsappLoginConnected).toBe(false);
    expect(state.whatsappLoginQrDataUrl).toBe("data:image/png;base64,next-qr");
    expect(state.whatsappBusy).toBe(false);
  });
});

describe("channels controller manual restart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls channels.restart for the given channel and clears the busy flag", async () => {
    const state = createState();
    const request = vi.mocked(state.client!.request);
    request.mockResolvedValueOnce({ channel: "guildchat", accountId: "default", started: true });

    await restartChannel(state, "guildchat");

    expect(request).toHaveBeenCalledWith("channels.restart", {
      channel: "guildchat",
      accountId: undefined,
    });
    expect(state.channelRestartingKey).toBeNull();
    expect(state.channelsError).toBeNull();
  });

  it("records the error and clears the busy flag when the restart fails", async () => {
    const state = createState();
    const request = vi.mocked(state.client!.request);
    request.mockRejectedValueOnce(new Error("boom"));

    await restartChannel(state, "guildchat");

    expect(state.channelsError).toContain("boom");
    expect(state.channelRestartingKey).toBeNull();
  });

  it("ignores a restart request while another restart is already in flight", async () => {
    const state = createState();
    state.channelRestartingKey = "guildchat";
    const request = vi.mocked(state.client!.request);

    await restartChannel(state, "quietchat");

    expect(request).not.toHaveBeenCalled();
  });
});

describe("channels controller delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls channels.delete after confirming and clears the busy flag", async () => {
    const state = createState();
    const request = vi.mocked(state.client!.request);
    request.mockResolvedValueOnce({ channel: "guildchat", accountId: "default", deleted: true });

    const result = await deleteChannelAccount(state, "guildchat");

    expect(request).toHaveBeenCalledWith("channels.delete", {
      channel: "guildchat",
      accountId: undefined,
    });
    expect(result).toBe(true);
    expect(state.channelDeletingKey).toBeNull();
    expect(state.channelsError).toBeNull();
  });

  it("does not call channels.delete when the confirmation is declined", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const state = createState();
    const request = vi.mocked(state.client!.request);

    const result = await deleteChannelAccount(state, "guildchat");

    expect(request).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it("records the error and clears the busy flag when delete fails", async () => {
    const state = createState();
    const request = vi.mocked(state.client!.request);
    request.mockRejectedValueOnce(new Error("boom"));

    const result = await deleteChannelAccount(state, "guildchat");

    expect(result).toBe(false);
    expect(state.channelsError).toContain("boom");
    expect(state.channelDeletingKey).toBeNull();
  });
});
