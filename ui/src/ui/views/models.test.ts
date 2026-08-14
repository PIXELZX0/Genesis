import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { renderModels, type ModelsProps } from "./models.ts";

function createProps(overrides: Partial<ModelsProps> = {}): ModelsProps {
  return {
    connected: true,
    loading: false,
    models: [],
    modelAuthStatus: null,
    panel: "providers",
    error: null,
    modelProviderWizardStep: null,
    modelProviderWizardInput: null,
    modelProviderWizardBusy: false,
    modelProviderWizardError: null,
    modelProviderWizardMessage: null,
    onPanelChange: () => undefined,
    onRefresh: () => undefined,
    onModelProviderWizardStart: () => undefined,
    onModelProviderWizardSubmit: () => undefined,
    onModelProviderWizardCancel: () => undefined,
    onModelProviderWizardInput: () => undefined,
    onModelProviderWizardClose: () => undefined,
    ...overrides,
  };
}

function findButton(container: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
    button.textContent?.includes(label),
  );
}

describe("renderModels", () => {
  it("starts the shared provider wizard from the Providers panel", () => {
    const container = document.createElement("div");
    const onModelProviderWizardStart = vi.fn();
    render(renderModels(createProps({ onModelProviderWizardStart })), container);

    findButton(container, "Add provider")?.click();

    expect(onModelProviderWizardStart).toHaveBeenCalledWith("models");
  });

  it("starts the custom model wizard from the Catalog panel", () => {
    const container = document.createElement("div");
    const onModelProviderWizardStart = vi.fn();
    render(renderModels(createProps({ panel: "catalog", onModelProviderWizardStart })), container);

    findButton(container, "Add model")?.click();

    expect(onModelProviderWizardStart).toHaveBeenCalledWith("custom-model");
  });

  it("renders per-provider auth status and usage, including providers with no models", () => {
    const container = document.createElement("div");
    render(
      renderModels(
        createProps({
          models: [{ id: "claude-opus-5", provider: "anthropic" } as ModelsProps["models"][number]],
          modelAuthStatus: {
            ts: 1,
            providers: [
              {
                provider: "anthropic",
                displayName: "Anthropic",
                status: "ok",
                profiles: [],
                usage: { windows: [{ label: "5h", usedPercent: 40 }] },
              },
              {
                provider: "openai",
                displayName: "OpenAI",
                status: "missing",
                profiles: [],
              },
            ],
          },
        }),
      ),
      container,
    );

    const text = container.textContent ?? "";
    expect(text).toContain("Connected");
    expect(text).toContain("60% left");
    // Configured-but-not-logged-in provider shows up even with zero models.
    expect(text).toContain("OpenAI");
    expect(text).toContain("Auth required");
  });

  it("renders server-provided wizard steps and wires advance and cancel actions", () => {
    const container = document.createElement("div");
    const onModelProviderWizardInput = vi.fn();
    const onModelProviderWizardSubmit = vi.fn();
    const onModelProviderWizardCancel = vi.fn();
    render(
      renderModels(
        createProps({
          modelProviderWizardStep: {
            id: "provider",
            type: "select",
            title: "Choose a provider",
            message: "Select the provider to connect.",
            options: [
              { value: "anthropic", label: "Anthropic" },
              { value: "openai", label: "OpenAI", hint: "API key or subscription" },
            ],
          },
          modelProviderWizardInput: "anthropic",
          onModelProviderWizardInput,
          onModelProviderWizardSubmit,
          onModelProviderWizardCancel,
        }),
      ),
      container,
    );

    expect(container.querySelector('[role="dialog"]')?.textContent).toContain("Choose a provider");
    expect(container.textContent).toContain("Select the provider to connect.");
    findButton(container, "OpenAI")?.click();
    findButton(container, "Continue")?.click();
    findButton(container, "Cancel")?.click();

    expect(onModelProviderWizardInput).toHaveBeenCalledWith("openai");
    expect(onModelProviderWizardSubmit).toHaveBeenCalledOnce();
    expect(onModelProviderWizardCancel).toHaveBeenCalledOnce();
  });
});
