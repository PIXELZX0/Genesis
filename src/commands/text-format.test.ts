import { describe, expect, it } from "vitest";
import { shortenText } from "./text-format.js";

describe("shortenText", () => {
  it("returns original text when it fits", () => {
    expect(shortenText("genesis", 16)).toBe("genesis");
  });

  it("truncates and appends ellipsis when over limit", () => {
    expect(shortenText("genesis-status-output", 10)).toBe("genesis-s…");
  });

  it("counts multi-byte characters correctly", () => {
    expect(shortenText("hello🙂world", 7)).toBe("hello🙂…");
  });
});
