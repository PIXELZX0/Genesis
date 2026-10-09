import { describe, expect, it, vi } from "vitest";

const musicGenerationTaskStatusMocks = vi.hoisted(() => ({
  buildActiveMusicGenerationTaskPromptContextForSession: vi.fn(),
}));

const videoGenerationTaskStatusMocks = vi.hoisted(() => ({
  buildActiveVideoGenerationTaskPromptContextForSession: vi.fn(),
}));

vi.mock("../../music-generation-task-status.js", () => musicGenerationTaskStatusMocks);
vi.mock("../../video-generation-task-status.js", () => videoGenerationTaskStatusMocks);

import {
  hasPromptSubmissionContent,
  resolveAttemptTurnContext,
  shouldRunPreemptiveContextPrecheck,
} from "./attempt.prompt-helpers.js";

describe("resolveAttemptTurnContext", () => {
  it("joins active video and music task guidance for user turns", () => {
    videoGenerationTaskStatusMocks.buildActiveVideoGenerationTaskPromptContextForSession.mockReturnValue(
      "Active task hint",
    );
    musicGenerationTaskStatusMocks.buildActiveMusicGenerationTaskPromptContextForSession.mockReturnValue(
      "Music task hint",
    );

    const result = resolveAttemptTurnContext({
      sessionKey: "agent:main:discord:direct:123",
      trigger: "user",
    });

    expect(
      videoGenerationTaskStatusMocks.buildActiveVideoGenerationTaskPromptContextForSession,
    ).toHaveBeenCalledWith("agent:main:discord:direct:123");
    expect(
      musicGenerationTaskStatusMocks.buildActiveMusicGenerationTaskPromptContextForSession,
    ).toHaveBeenCalledWith("agent:main:discord:direct:123");
    expect(result).toBe("Active task hint\n\nMusic task hint");
  });

  it("skips active task guidance for non-user triggers", () => {
    videoGenerationTaskStatusMocks.buildActiveVideoGenerationTaskPromptContextForSession.mockReset();
    videoGenerationTaskStatusMocks.buildActiveVideoGenerationTaskPromptContextForSession.mockReturnValue(
      "Should not be used",
    );
    musicGenerationTaskStatusMocks.buildActiveMusicGenerationTaskPromptContextForSession.mockReset();
    musicGenerationTaskStatusMocks.buildActiveMusicGenerationTaskPromptContextForSession.mockReturnValue(
      "Should not be used",
    );

    const result = resolveAttemptTurnContext({
      sessionKey: "agent:main:discord:direct:123",
      trigger: "cron",
    });

    expect(
      videoGenerationTaskStatusMocks.buildActiveVideoGenerationTaskPromptContextForSession,
    ).not.toHaveBeenCalled();
    expect(
      musicGenerationTaskStatusMocks.buildActiveMusicGenerationTaskPromptContextForSession,
    ).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });
});

describe("hasPromptSubmissionContent", () => {
  it("rejects empty prompt submissions without history or images", () => {
    expect(
      hasPromptSubmissionContent({
        prompt: "   ",
        messages: [],
        imageCount: 0,
      }),
    ).toBe(false);
  });

  it("allows blank prompt submissions when replay history has content", () => {
    expect(
      hasPromptSubmissionContent({
        prompt: "   ",
        messages: [{ role: "user", content: "previous turn", timestamp: 1 }],
        imageCount: 0,
      }),
    ).toBe(true);
  });

  it("allows text or image prompt submissions", () => {
    expect(
      hasPromptSubmissionContent({
        prompt: "hello",
        messages: [],
        imageCount: 0,
      }),
    ).toBe(true);
    expect(
      hasPromptSubmissionContent({
        prompt: "   ",
        messages: [],
        imageCount: 1,
      }),
    ).toBe(true);
  });
});

describe("shouldRunPreemptiveContextPrecheck", () => {
  it("skips context precheck after prompt submission was already skipped", () => {
    expect(
      shouldRunPreemptiveContextPrecheck({
        skipPromptSubmission: true,
      }),
    ).toBe(false);
  });

  it("runs context precheck while a prompt submission is still pending", () => {
    expect(
      shouldRunPreemptiveContextPrecheck({
        skipPromptSubmission: false,
      }),
    ).toBe(true);
  });
});
