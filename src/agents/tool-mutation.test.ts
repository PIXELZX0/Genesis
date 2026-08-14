import { describe, expect, it } from "vitest";
import {
  buildToolActionFingerprint,
  buildToolMutationState,
  isLikelyMutatingToolName,
  isMutatingToolCall,
  isSameToolMutationAction,
} from "./tool-mutation.js";

describe("tool mutation helpers", () => {
  it("treats session_status as mutating only when model override is provided", () => {
    expect(isMutatingToolCall("session_status", { sessionKey: "agent:main:main" })).toBe(false);
    expect(
      isMutatingToolCall("session_status", {
        sessionKey: "agent:main:main",
        model: "openai/gpt-4o",
      }),
    ).toBe(true);
  });

  it("treats only persistent-agent mutations as mutating", () => {
    expect(isMutatingToolCall("agents_manage", { action: "list" })).toBe(false);
    expect(isMutatingToolCall("agents_manage", { action: "create" })).toBe(true);
    expect(isMutatingToolCall("agents_manage", { action: "update" })).toBe(true);
    expect(isMutatingToolCall("agents_manage", { action: "delete" })).toBe(true);
  });

  it("fingerprints agents_manage mutation targets across agentId aliases", () => {
    const updateAlpha = buildToolActionFingerprint("agents_manage", {
      action: "update",
      agentId: "alpha",
    });
    const updateBeta = buildToolActionFingerprint("agents_manage", {
      action: "update",
      agentId: "beta",
    });
    const deleteAlpha = buildToolActionFingerprint("agents_manage", {
      action: "delete",
      agentId: "alpha",
    });
    const deleteSnakeAlpha = buildToolActionFingerprint("agents_manage", {
      action: "delete",
      agent_id: "alpha",
    });
    const deleteSnakeBeta = buildToolActionFingerprint("agents_manage", {
      action: "delete",
      agent_id: "beta",
    });

    expect(updateAlpha).toBe("tool=agents_manage|action=update|agentid=alpha");
    expect(updateBeta).toBe("tool=agents_manage|action=update|agentid=beta");
    expect(deleteAlpha).toBe("tool=agents_manage|action=delete|agentid=alpha");
    expect(deleteSnakeAlpha).toBe(deleteAlpha);
    expect(deleteSnakeBeta).toBe("tool=agents_manage|action=delete|agentid=beta");
    expect(updateAlpha).not.toBe(updateBeta);
    expect(deleteAlpha).not.toBe(deleteSnakeBeta);
    expect(buildToolActionFingerprint("agents_manage", { action: "list" })).toBeUndefined();
  });

  it("builds stable fingerprints for mutating calls and omits read-only calls", () => {
    const writeFingerprint = buildToolActionFingerprint(
      "write",
      { path: "/tmp/demo.txt", id: 42 },
      "write /tmp/demo.txt",
    );
    expect(writeFingerprint).toContain("tool=write");
    expect(writeFingerprint).toContain("path=/tmp/demo.txt");
    expect(writeFingerprint).toContain("id=42");
    expect(writeFingerprint).not.toContain("meta=write /tmp/demo.txt");

    const metaOnlyFingerprint = buildToolActionFingerprint("exec", { command: "ls -la" }, "ls -la");
    expect(metaOnlyFingerprint).toContain("tool=exec");
    expect(metaOnlyFingerprint).toContain("meta=ls -la");

    const readFingerprint = buildToolActionFingerprint("read", { path: "/tmp/demo.txt" });
    expect(readFingerprint).toBeUndefined();
  });

  it("treats coding-tool path aliases as the same stable target", () => {
    const filePathFingerprint = buildToolActionFingerprint("edit", {
      file_path: "/tmp/demo.txt",
      old_string: "before",
      new_string: "after",
    });
    const fileAliasFingerprint = buildToolActionFingerprint("edit", {
      file: "/tmp/demo.txt",
      oldText: "before",
      newText: "after again",
    });

    expect(filePathFingerprint).toBe("tool=edit|path=/tmp/demo.txt");
    expect(fileAliasFingerprint).toBe("tool=edit|path=/tmp/demo.txt");
  });

  it("exposes mutation state for downstream payload rendering", () => {
    expect(
      buildToolMutationState("message", { action: "send", to: "forum:1" }).mutatingAction,
    ).toBe(true);
    expect(buildToolMutationState("browser", { action: "list" }).mutatingAction).toBe(false);
    expect(
      buildToolMutationState("subagents", { action: "kill", target: "worker-1" }).mutatingAction,
    ).toBe(true);
    expect(
      buildToolMutationState("subagents", { action: "steer", target: "worker-1" }).mutatingAction,
    ).toBe(true);
    expect(buildToolMutationState("subagents", { action: "list" }).mutatingAction).toBe(false);
  });

  it("matches tool actions by fingerprint and fails closed on asymmetric data", () => {
    expect(
      isSameToolMutationAction(
        { toolName: "write", actionFingerprint: "tool=write|path=/tmp/a" },
        { toolName: "write", actionFingerprint: "tool=write|path=/tmp/a" },
      ),
    ).toBe(true);
    expect(
      isSameToolMutationAction(
        { toolName: "write", actionFingerprint: "tool=write|path=/tmp/a" },
        { toolName: "write", actionFingerprint: "tool=write|path=/tmp/b" },
      ),
    ).toBe(false);
    expect(
      isSameToolMutationAction(
        { toolName: "write", actionFingerprint: "tool=write|path=/tmp/a" },
        { toolName: "write" },
      ),
    ).toBe(false);
  });

  it("keeps legacy name-only mutating heuristics for payload fallback", () => {
    expect(isLikelyMutatingToolName("sessions_spawn")).toBe(true);
    expect(isLikelyMutatingToolName("sessions_send")).toBe(true);
    expect(isLikelyMutatingToolName("agents_manage")).toBe(true);
    expect(isLikelyMutatingToolName("browser_actions")).toBe(true);
    expect(isLikelyMutatingToolName("message_slack")).toBe(true);
    expect(isLikelyMutatingToolName("browser")).toBe(false);
  });
});
