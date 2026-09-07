import { describe, expect, it } from "vitest";
import { classifyControlUiRequest, isControlUiOwnedRequest } from "./control-ui-routing.js";

describe("classifyControlUiRequest", () => {
  describe("root-mounted control ui", () => {
    it.each([
      {
        name: "serves the root entrypoint",
        pathname: "/",
        method: "GET",
        expected: { kind: "serve" as const },
      },
      {
        name: "serves other read-only SPA routes",
        pathname: "/chat",
        method: "HEAD",
        expected: { kind: "serve" as const },
      },
      {
        name: "keeps health probes outside the SPA catch-all",
        pathname: "/healthz",
        method: "GET",
        expected: { kind: "not-control-ui" as const },
      },
      {
        name: "keeps readiness probes outside the SPA catch-all",
        pathname: "/ready",
        method: "HEAD",
        expected: { kind: "not-control-ui" as const },
      },
      {
        name: "keeps plugin routes outside the SPA catch-all",
        pathname: "/plugins/webhook",
        method: "GET",
        expected: { kind: "not-control-ui" as const },
      },
      {
        name: "keeps API routes outside the SPA catch-all",
        pathname: "/api/sessions",
        method: "GET",
        expected: { kind: "not-control-ui" as const },
      },
      {
        name: "returns not-found for legacy ui routes",
        pathname: "/ui/settings",
        method: "GET",
        expected: { kind: "not-found" as const },
      },
      {
        name: "falls through non-read requests",
        pathname: "/bluebubbles-webhook",
        method: "POST",
        expected: { kind: "not-control-ui" as const },
      },
    ])("$name", ({ pathname, method, expected }) => {
      expect(
        classifyControlUiRequest({
          basePath: "",
          pathname,
          search: "",
          method,
        }),
      ).toEqual(expected);
    });
  });

  describe("basePath-mounted control ui", () => {
    it.each([
      {
        name: "redirects the basePath entrypoint",
        pathname: "/genesis",
        search: "?foo=1",
        method: "GET",
        expected: { kind: "redirect" as const, location: "/genesis/?foo=1" },
      },
      {
        name: "serves nested read-only routes",
        pathname: "/genesis/chat",
        search: "",
        method: "HEAD",
        expected: { kind: "serve" as const },
      },
      {
        name: "falls through unmatched paths",
        pathname: "/elsewhere/chat",
        search: "",
        method: "GET",
        expected: { kind: "not-control-ui" as const },
      },
      {
        name: "falls through write requests to the basePath entrypoint",
        pathname: "/genesis",
        search: "",
        method: "POST",
        expected: { kind: "not-control-ui" as const },
      },
      ...["PUT", "DELETE", "PATCH", "OPTIONS"].map((method) => ({
        name: `falls through ${method} subroute requests`,
        pathname: "/genesis/webhook",
        search: "",
        method,
        expected: { kind: "not-control-ui" as const },
      })),
    ])("$name", ({ pathname, search, method, expected }) => {
      expect(
        classifyControlUiRequest({
          basePath: "/genesis",
          pathname,
          search,
          method,
        }),
      ).toEqual(expected);
    });
  });
});

describe("isControlUiOwnedRequest", () => {
  const owned = (pathname: string, method = "GET", basePath?: string, search = "") =>
    isControlUiOwnedRequest({ basePath, pathname, search, method });

  it("claims UI documents, media, upload, and avatar routes at the root mount", () => {
    expect(owned("/")).toBe(true);
    expect(owned("/assets/app.js")).toBe(true);
    expect(owned("/__genesis__/assistant-media", "POST")).toBe(true);
    expect(owned("/__genesis__/assistant-media-token", "POST")).toBe(true);
    expect(owned("/__genesis__/canvas-upload", "POST")).toBe(true);
    expect(owned("/avatar/main")).toBe(true);
  });

  it("skips traffic the Control UI never serves", () => {
    expect(owned("/api/unclaimed")).toBe(false);
    expect(owned("/plugins/slack/events", "POST")).toBe(false);
    expect(owned("/healthz")).toBe(false);
    expect(owned("/slack/events", "POST")).toBe(false);
    // Root-mounted SPA still owns bare reads; only writes fall through.
    expect(owned("/avatar", "POST")).toBe(false);
  });

  it("honors a mounted base path", () => {
    expect(owned("/console/", "GET", "/console/")).toBe(true);
    expect(owned("/console", "GET", "/console")).toBe(true);
    expect(owned("/console/__genesis__/assistant-media", "POST", "/console")).toBe(true);
    expect(owned("/console/avatar/main", "GET", "/console")).toBe(true);
    expect(owned("/outside-console", "GET", "/console")).toBe(false);
  });
});
