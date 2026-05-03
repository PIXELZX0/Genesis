import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayRequestHandlerOptions } from "./types.js";

const mocks = vi.hoisted(() => ({
  readConfigFileSnapshot: vi.fn(),
  normalizeAnyChannelId: vi.fn((value: string | null | undefined) => value ?? null),
  runInteractiveChannelsAddWizard: vi.fn(),
}));

vi.mock("../../config/config.js", () => ({
  readConfigFileSnapshot: mocks.readConfigFileSnapshot,
}));

vi.mock("../../channels/registry.js", () => ({
  normalizeAnyChannelId: mocks.normalizeAnyChannelId,
}));

vi.mock("../../flows/channel-add-wizard.js", () => ({
  runInteractiveChannelsAddWizard: mocks.runInteractiveChannelsAddWizard,
}));

import { wizardHandlers } from "./wizard.js";

function createContext() {
  const wizardSessions = new Map();
  return {
    wizardSessions,
    findRunningWizard: vi.fn(() => {
      for (const [id, session] of wizardSessions) {
        if (session.getStatus() === "running") {
          return id;
        }
      }
      return null;
    }),
    purgeWizardSession: vi.fn((id: string) => {
      const session = wizardSessions.get(id);
      if (session?.getStatus() !== "running") {
        wizardSessions.delete(id);
      }
    }),
    wizardRunner: vi.fn(),
  };
}

async function callWizard(
  method: "wizard.start" | "wizard.next",
  params: Record<string, unknown>,
  context: ReturnType<typeof createContext>,
) {
  const respond = vi.fn();
  await wizardHandlers[method]({
    req: { type: "req", id: "req-1", method, params },
    params,
    client: null,
    isWebchatConnect: () => false,
    respond,
    context,
  } as unknown as GatewayRequestHandlerOptions);
  expect(respond).toHaveBeenCalledWith(true, expect.anything(), undefined);
  return respond.mock.calls[0]?.[1] as {
    sessionId?: string;
    done: boolean;
    status: "running" | "done" | "cancelled" | "error";
    step?: { id: string; type: string; title?: string; message?: string };
    error?: string;
  };
}

describe("wizardHandlers channel setup target", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readConfigFileSnapshot.mockResolvedValue({
      exists: true,
      valid: true,
      config: { channels: {} },
      sourceConfig: { channels: {} },
      hash: "hash-1",
    });
    mocks.normalizeAnyChannelId.mockImplementation((value: string | null | undefined) =>
      value ? value : null,
    );
    mocks.runInteractiveChannelsAddWizard.mockImplementation(async ({ prompter }) => {
      await prompter.intro("Channel setup");
      const selected = await prompter.select({
        message: "Select a channel",
        options: [{ value: "telegram", label: "Telegram" }],
      });
      await prompter.outro(`Selected ${selected}`);
    });
  });

  it("runs the channel add wizard through the shared wizard session", async () => {
    const context = createContext();
    const start = await callWizard(
      "wizard.start",
      { target: "channels", channel: "telegram" },
      context,
    );

    expect(start.sessionId).toEqual(expect.any(String));
    expect(start.step).toMatchObject({ type: "note", title: "Channel setup" });
    expect(mocks.runInteractiveChannelsAddWizard).toHaveBeenCalledWith(
      expect.objectContaining({
        cfg: { channels: {} },
        baseHash: "hash-1",
        initialSelection: ["telegram"],
      }),
    );

    const select = await callWizard(
      "wizard.next",
      { sessionId: start.sessionId, answer: { stepId: start.step?.id, value: true } },
      context,
    );
    expect(select.step).toMatchObject({ type: "select", message: "Select a channel" });

    const outro = await callWizard(
      "wizard.next",
      { sessionId: start.sessionId, answer: { stepId: select.step?.id, value: "telegram" } },
      context,
    );
    expect(outro.step).toMatchObject({ type: "note", title: "Done" });

    const done = await callWizard(
      "wizard.next",
      { sessionId: start.sessionId, answer: { stepId: outro.step?.id, value: true } },
      context,
    );
    expect(done).toMatchObject({ done: true, status: "done" });
  });
});
