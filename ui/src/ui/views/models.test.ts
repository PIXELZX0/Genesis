import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { renderModels, type ModelsProps } from "./models.ts";

function createProps(overrides: Partial<ModelsProps> = {}): ModelsProps {
  return {
    connected: true,
    loading: false,
    models: [],
    panel: "providers",
    error: null,
    dialog: null,
    modelProviderWizardStep: null,
    modelProviderWizardInput: null,
    modelProviderWizardBusy: false,
    modelProviderWizardError: null,
    modelProviderWizardMessage: null,
    onPanelChange: () => undefined,
    onRefresh: () => undefined,
    onOpenAddModel: () => undefined,
    onModelProviderWizardStart: () => undefined,
    onModelProviderWizardSubmit: () => undefined,
    onModelProviderWizardCancel: () => undefined,
    onModelProviderWizardInput: () => undefined,
    onModelProviderWizardClose: () => undefined,
    onDialogFieldChange: () => undefined,
    onDialogCancel: () => undefined,
    onDialogSubmit: () => undefined,
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
    const onOpenAddModel = vi.fn();
    render(renderModels(createProps({ onModelProviderWizardStart, onOpenAddModel })), container);

    findButton(container, "Add provider")?.click();

    expect(onModelProviderWizardStart).toHaveBeenCalledOnce();
    expect(onOpenAddModel).not.toHaveBeenCalled();
  });

  it("keeps Add model wired to the custom model dialog", () => {
    const container = document.createElement("div");
    const onModelProviderWizardStart = vi.fn();
    const onOpenAddModel = vi.fn();
    render(
      renderModels(createProps({ panel: "catalog", onModelProviderWizardStart, onOpenAddModel })),
      container,
    );

    findButton(container, "Add model")?.click();

    expect(onOpenAddModel).toHaveBeenCalledOnce();
    expect(onModelProviderWizardStart).not.toHaveBeenCalled();
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
