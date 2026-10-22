import { describe, expect, it } from "vitest";
import { sanitizeForLog, splitGraphemes, stripAnsi, visibleWidth } from "./ansi.js";

describe("terminal ansi helpers", () => {
  it("strips ANSI and OSC8 sequences", () => {
    expect(stripAnsi("\u001B[31mred\u001B[0m")).toBe("red");
    expect(stripAnsi("\u001B[2K\u001B[1Ared")).toBe("red");
    expect(stripAnsi("\u001B]8;;https://genesis.pixelzx.com\u001B\\link\u001B]8;;\u001B\\")).toBe(
      "link",
    );
    expect(stripAnsi("\u001B]8;;https://genesis.pixelzx.com\u0007link\u001B]8;;\u0007")).toBe(
      "link",
    );
  });

  it("strips APC strings such as pi-tui cursor markers", () => {
    expect(stripAnsi("> m\u001B_pi:fc\u0007 \u001B_pi:/fc\u0007")).toBe("> m ");
    expect(stripAnsi("a\u001B_pi:c\u001B\\b")).toBe("ab");
    expect(visibleWidth("search: x\u001B_pi:fc\u0007 \u001B_pi:/fc\u0007")).toBe(10);
  });

  it("sanitizes control characters for log-safe interpolation", () => {
    const input =
      "\u001B[31mwarn\u001B[0m" +
      "\r\n" +
      "next" +
      String.fromCharCode(0) +
      "line" +
      String.fromCharCode(127) +
      String.fromCharCode(0x9b) +
      "done";
    expect(sanitizeForLog(input)).toBe("warnnextlinedone");
  });

  it("measures wide graphemes by terminal cell width", () => {
    expect(visibleWidth("abc")).toBe(3);
    expect(visibleWidth("📸 skill")).toBe(8);
    expect(visibleWidth("表")).toBe(2);
    expect(visibleWidth("\u001B[31m📸\u001B[0m")).toBe(2);
  });

  it("keeps emoji zwj sequences as single graphemes", () => {
    expect(splitGraphemes("👨‍👩‍👧‍👦")).toEqual(["👨‍👩‍👧‍👦"]);
    expect(visibleWidth("👨‍👩‍👧‍👦")).toBe(2);
  });
});
