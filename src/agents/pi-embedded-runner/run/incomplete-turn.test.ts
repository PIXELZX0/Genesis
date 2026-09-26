import { describe, expect, it } from "vitest";
import { appendTruncatedReplyNotice, TRUNCATED_REPLY_NOTICE_TEXT } from "./incomplete-turn.js";

type NoticeAttempt = Parameters<typeof appendTruncatedReplyNotice>[0]["attempt"];

function attempt(stopReason: string, assistantTexts = ["partial answer"]): NoticeAttempt {
  return { assistantTexts, lastAssistant: { stopReason } } as unknown as NoticeAttempt;
}

describe("appendTruncatedReplyNotice", () => {
  it("labels partial text from a length stop", () => {
    expect(
      appendTruncatedReplyNotice({
        payloads: [{ text: "partial answer" }],
        attempt: attempt("length"),
      }),
    ).toEqual([{ text: "partial answer" }, { text: TRUNCATED_REPLY_NOTICE_TEXT }]);
  });

  it("leaves complete, empty, and error-only replies alone", () => {
    const payloads = [{ text: "done" }];
    expect(appendTruncatedReplyNotice({ payloads, attempt: attempt("stop") })).toBe(payloads);
    expect(appendTruncatedReplyNotice({ payloads: [], attempt: attempt("length") })).toEqual([]);
    const errorOnly = [{ text: "tool failed", isError: true }];
    expect(appendTruncatedReplyNotice({ payloads: errorOnly, attempt: attempt("length") })).toBe(
      errorOnly,
    );
    expect(appendTruncatedReplyNotice({ payloads, attempt: attempt("length", ["NO_REPLY"]) })).toBe(
      payloads,
    );
  });
});
