/* @vitest-environment jsdom */

import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { labelForBackup, renderConfigBackupsView } from "./config-backups.ts";

function createProps(overrides: Record<string, unknown> = {}) {
  return {
    dir: "/tmp/genesis/config_backup",
    entries: [
      { id: "bak", bytes: 2048, modifiedAt: Date.now() - 60_000 },
      { id: "last-good", bytes: 1024, modifiedAt: Date.now() - 120_000 },
    ],
    loading: false,
    error: null,
    restoreId: null,
    restoring: false,
    onRestoreRequest: vi.fn(),
    ...overrides,
  };
}

describe("labelForBackup", () => {
  it("names the ring positions and the special copies", () => {
    expect(labelForBackup("bak")).toBe("Previous config");
    expect(labelForBackup("bak.3")).toBe("3 writes ago");
    expect(labelForBackup("last-good")).toBe("Last known good");
  });
});

describe("renderConfigBackupsView", () => {
  it("asks for confirmation instead of restoring on the first click", () => {
    const onRestoreRequest = vi.fn();
    const container = document.createElement("div");
    render(renderConfigBackupsView(createProps({ onRestoreRequest })), container);

    const restore = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Restore",
    );
    restore?.click();

    expect(onRestoreRequest).toHaveBeenCalledWith("bak");
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("shows the restore dialog once a backup is picked", () => {
    const container = document.createElement("div");
    render(renderConfigBackupsView(createProps({ restoreId: "last-good" })), container);

    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Restore Last known good?");
  });
});
