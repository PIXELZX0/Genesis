import type { PluginRuntime } from "genesis/plugin-sdk/core";
import { describe, expect, it } from "vitest";
import { getQQBotRuntime, setQQBotRuntime } from "./runtime.js";

describe("qqbot runtime store", () => {
  it("does not force lazy runtime resolution while applying the setup-runtime setter", () => {
    const lazyRuntime = new Proxy({} as PluginRuntime, {
      get(_target, prop) {
        if (prop === "version") {
          throw new Error("runtime module should stay lazy");
        }
        return undefined;
      },
    });

    expect(() => setQQBotRuntime(lazyRuntime)).not.toThrow();
    expect(getQQBotRuntime()).toBe(lazyRuntime);
  });
});
