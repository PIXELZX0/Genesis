import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillSnapshot } from "../../agents/skills.js";

const {
  buildWorkspaceSkillSnapshotMock,
  ensureSkillsWatcherMock,
  getSkillsSnapshotVersionMock,
  shouldRefreshSnapshotForVersionMock,
  getRemoteSkillEligibilityMock,
  resolveAgentConfigMock,
  resolveSessionAgentIdMock,
  resolveAgentIdFromSessionKeyMock,
} = vi.hoisted(() => ({
  buildWorkspaceSkillSnapshotMock: vi.fn(
    (): SkillSnapshot => ({ prompt: "", skills: [], resolvedSkills: [] }),
  ),
  ensureSkillsWatcherMock: vi.fn(),
  getSkillsSnapshotVersionMock: vi.fn((_workspaceDir?: string): number => 0),
  shouldRefreshSnapshotForVersionMock: vi.fn(
    (_cachedVersion?: number, _nextVersion?: number): boolean => false,
  ),
  getRemoteSkillEligibilityMock: vi.fn(() => ({
    platforms: [],
    hasBin: () => false,
    hasAnyBin: () => false,
  })),
  resolveAgentConfigMock: vi.fn(() => undefined),
  resolveSessionAgentIdMock: vi.fn(() => "writer"),
  resolveAgentIdFromSessionKeyMock: vi.fn(() => "main"),
}));

vi.mock("../../agents/agent-scope.js", () => ({
  resolveAgentConfig: resolveAgentConfigMock,
  resolveSessionAgentId: resolveSessionAgentIdMock,
}));

vi.mock("../../agents/skills.js", () => ({
  buildWorkspaceSkillSnapshot: buildWorkspaceSkillSnapshotMock,
}));

vi.mock("../../agents/skills/refresh-state.js", () => ({
  getSkillsSnapshotVersion: getSkillsSnapshotVersionMock,
  shouldRefreshSnapshotForVersion: shouldRefreshSnapshotForVersionMock,
}));

vi.mock("../../agents/skills/refresh.js", () => ({
  ensureSkillsWatcher: ensureSkillsWatcherMock,
}));

vi.mock("../../config/sessions.js", () => ({
  updateSessionStore: vi.fn(),
  resolveSessionFilePath: vi.fn(),
  resolveSessionFilePathOptions: vi.fn(),
}));

vi.mock("../../infra/skills-remote.js", () => ({
  getRemoteSkillEligibility: getRemoteSkillEligibilityMock,
}));

vi.mock("../../routing/session-key.js", () => ({
  normalizeAgentId: (id: string) => id,
  normalizeMainKey: (key?: string) => key ?? "main",
  resolveAgentIdFromSessionKey: resolveAgentIdFromSessionKeyMock,
}));

const { ensureSkillSnapshot } = await import("./session-updates.js");

describe("ensureSkillSnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildWorkspaceSkillSnapshotMock.mockReturnValue({ prompt: "", skills: [], resolvedSkills: [] });
    getSkillsSnapshotVersionMock.mockReturnValue(0);
    shouldRefreshSnapshotForVersionMock.mockImplementation((cachedVersion, nextVersion) => {
      const cached = typeof cachedVersion === "number" ? cachedVersion : 0;
      const next = typeof nextVersion === "number" ? nextVersion : 0;
      return next === 0 ? cached > 0 : cached < next;
    });
    getRemoteSkillEligibilityMock.mockReturnValue({
      platforms: [],
      hasBin: () => false,
      hasAnyBin: () => false,
    });
    resolveAgentConfigMock.mockReturnValue(undefined);
    resolveSessionAgentIdMock.mockReturnValue("writer");
    resolveAgentIdFromSessionKeyMock.mockReturnValue("main");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses config-aware session agent resolution for legacy session keys", async () => {
    vi.stubEnv("GENESIS_TEST_FAST", "0");

    await ensureSkillSnapshot({
      sessionKey: "main",
      isFirstTurnInSession: false,
      workspaceDir: "/tmp/workspace",
      cfg: {
        agents: {
          list: [{ id: "writer", default: true }],
        },
      },
    });

    expect(resolveSessionAgentIdMock).toHaveBeenCalledWith({
      sessionKey: "main",
      config: {
        agents: {
          list: [{ id: "writer", default: true }],
        },
      },
    });
    expect(buildWorkspaceSkillSnapshotMock).toHaveBeenCalledWith(
      "/tmp/workspace",
      expect.objectContaining({ agentId: "writer" }),
    );
    expect(resolveAgentIdFromSessionKeyMock).not.toHaveBeenCalled();
  });

  it("reuses a valid carried snapshot on the first turn after rotation", async () => {
    vi.stubEnv("GENESIS_TEST_FAST", "0");
    getSkillsSnapshotVersionMock.mockReturnValue(7);
    const snapshot = {
      prompt: "cached",
      skills: [{ name: "alpha" }],
      resolvedSkills: [],
      skillFilter: ["alpha"],
      version: 7,
    };
    const sessionEntry = {
      sessionId: "rotated-session",
      updatedAt: 1,
      systemSent: false,
      skillsSnapshot: snapshot,
    };
    const sessionStore = { main: sessionEntry };

    const result = await ensureSkillSnapshot({
      sessionEntry,
      sessionStore,
      sessionKey: "main",
      sessionId: "rotated-session",
      isFirstTurnInSession: true,
      workspaceDir: "/tmp/workspace",
      cfg: {},
      skillFilter: ["alpha"],
    });

    expect(result.skillsSnapshot).toBe(snapshot);
    expect(buildWorkspaceSkillSnapshotMock).not.toHaveBeenCalled();
  });

  it("rebuilds a carried snapshot when its version is stale", async () => {
    vi.stubEnv("GENESIS_TEST_FAST", "0");
    getSkillsSnapshotVersionMock.mockReturnValue(8);
    const freshSnapshot = {
      prompt: "fresh",
      skills: [{ name: "alpha" }],
      resolvedSkills: [],
      skillFilter: ["alpha"],
      version: 8,
    };
    buildWorkspaceSkillSnapshotMock.mockReturnValue(freshSnapshot);
    const sessionEntry = {
      sessionId: "rotated-session",
      updatedAt: 1,
      systemSent: false,
      skillsSnapshot: {
        prompt: "stale",
        skills: [{ name: "alpha" }],
        skillFilter: ["alpha"],
        version: 7,
      },
    };

    const result = await ensureSkillSnapshot({
      sessionEntry,
      sessionStore: { main: sessionEntry },
      sessionKey: "main",
      sessionId: "rotated-session",
      isFirstTurnInSession: true,
      workspaceDir: "/tmp/workspace",
      cfg: {},
      skillFilter: ["alpha"],
    });

    expect(result.skillsSnapshot).toBe(freshSnapshot);
    expect(buildWorkspaceSkillSnapshotMock).toHaveBeenCalledOnce();
    expect(buildWorkspaceSkillSnapshotMock).toHaveBeenCalledWith(
      "/tmp/workspace",
      expect.objectContaining({ snapshotVersion: 8, skillFilter: ["alpha"] }),
    );
  });

  it("rebuilds a carried snapshot when the effective skill filter changes", async () => {
    vi.stubEnv("GENESIS_TEST_FAST", "0");
    getSkillsSnapshotVersionMock.mockReturnValue(7);
    const freshSnapshot = {
      prompt: "fresh",
      skills: [{ name: "beta" }],
      resolvedSkills: [],
      skillFilter: ["beta"],
      version: 7,
    };
    buildWorkspaceSkillSnapshotMock.mockReturnValue(freshSnapshot);
    const sessionEntry = {
      sessionId: "rotated-session",
      updatedAt: 1,
      systemSent: false,
      skillsSnapshot: {
        prompt: "cached",
        skills: [{ name: "alpha" }],
        skillFilter: ["alpha"],
        version: 7,
      },
    };

    const result = await ensureSkillSnapshot({
      sessionEntry,
      sessionStore: { main: sessionEntry },
      sessionKey: "main",
      sessionId: "rotated-session",
      isFirstTurnInSession: true,
      workspaceDir: "/tmp/workspace",
      cfg: {},
      skillFilter: ["beta"],
    });

    expect(result.skillsSnapshot).toBe(freshSnapshot);
    expect(buildWorkspaceSkillSnapshotMock).toHaveBeenCalledOnce();
    expect(buildWorkspaceSkillSnapshotMock).toHaveBeenCalledWith(
      "/tmp/workspace",
      expect.objectContaining({ snapshotVersion: 7, skillFilter: ["beta"] }),
    );
  });
});
