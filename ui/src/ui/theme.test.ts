import { describe, expect, it, vi } from "vitest";
import { parseThemeSelection, resolveSystemTheme, resolveTheme } from "./theme.ts";

describe("resolveTheme", () => {
  it("resolves to the explicit light/dark mode", () => {
    expect(resolveTheme("mono", "dark")).toBe("dark");
    expect(resolveTheme("mono", "light")).toBe("light");
  });

  it("uses system preference when mode is system", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    expect(resolveTheme("mono", "system")).toBe("light");
    vi.unstubAllGlobals();
  });
});

describe("resolveSystemTheme", () => {
  it("mirrors the active preferred color scheme", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    expect(resolveSystemTheme()).toBe("light");
    vi.unstubAllGlobals();
  });
});

describe("parseThemeSelection", () => {
  it("collapses every stored theme onto mono while preserving the mode", () => {
    expect(parseThemeSelection("system", undefined)).toEqual({
      theme: "mono",
      mode: "system",
    });
    expect(parseThemeSelection("fieldmanual", undefined)).toEqual({
      theme: "mono",
      mode: "dark",
    });
    expect(parseThemeSelection("knot", "light")).toEqual({
      theme: "mono",
      mode: "light",
    });
  });
});
