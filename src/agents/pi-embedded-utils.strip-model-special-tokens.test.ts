import { describe, expect, it } from "vitest";
import { stripModelSpecialTokens } from "./pi-embedded-utils.js";

/**
 * @see https://github.com/PIXELZX0/Genesis/issues/40020
 */
describe("stripModelSpecialTokens", () => {
  it("strips tokens and inserts space between adjacent words", () => {
    expect(stripModelSpecialTokens("<|user|>Question<|assistant|>Answer")).toBe("Question Answer");
  });

  it("strips full-width pipe variants (DeepSeek U+FF5C)", () => {
    expect(stripModelSpecialTokens("<｜begin▁of▁sentence｜>Hello there")).toBe("Hello there");
  });

  it("does not strip normal angle brackets or HTML", () => {
    expect(stripModelSpecialTokens("a < b && c > d")).toBe("a < b && c > d");
    expect(stripModelSpecialTokens("<div>hello</div>")).toBe("<div>hello</div>");
  });

  it("passes through text without tokens unchanged", () => {
    const text = "Just a normal response.";
    expect(stripModelSpecialTokens(text)).toBe(text);
  });
});

describe("stripModelSpecialTokens DSML tool-call blocks", () => {
  const block = [
    "<｜DSML｜tool_calls>",
    '<｜DSML｜invoke name="browser">',
    '<｜DSML｜parameter name="action" string="true">act</｜DSML｜parameter>',
    '<｜DSML｜parameter name="targetId" string="true">8919899B</｜DSML｜parameter>',
    "</｜DSML｜invoke>",
    "</｜DSML｜tool_calls>",
  ].join("\n");

  it("drops a complete DSML block including its arguments", () => {
    expect(stripModelSpecialTokens(`Let me scroll.\n${block}`)).toBe("Let me scroll.\n");
  });

  it("drops an unterminated block left by a truncated stream", () => {
    const truncated = block.split("\n").slice(0, 3).join("\n");
    expect(stripModelSpecialTokens(`Let me scroll.\n${truncated}`)).toBe("Let me scroll.\n");
  });

  it("drops stray DSML tags when the opening tag arrived in an earlier chunk", () => {
    expect(stripModelSpecialTokens('<｜DSML｜invoke name="browser">\n</｜DSML｜invoke>')).toBe(
      "\n",
    );
  });

  it("strips the ASCII pipe spelling too", () => {
    expect(stripModelSpecialTokens("<|DSML|tool_calls>x</|DSML|tool_calls>done")).toBe("done");
  });

  it("preserves DSML markup inside code spans and fenced blocks", () => {
    const inline = "The token `<｜DSML｜tool_calls>` opens the block.";
    expect(stripModelSpecialTokens(inline)).toBe(inline);
    const fenced = ["```", block, "```"].join("\n");
    expect(stripModelSpecialTokens(fenced)).toBe(fenced);
  });

  it("leaves lookalike prose untouched", () => {
    const text = "DSML is a markup dialect; a < b and c > d.";
    expect(stripModelSpecialTokens(text)).toBe(text);
  });
});
