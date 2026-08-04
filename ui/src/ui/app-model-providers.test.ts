import { describe, expect, it, vi } from "vitest";
import {
  handleModelProviderWizardCancel,
  handleModelProviderWizardInput,
  handleModelProviderWizardStart,
  handleModelProviderWizardSubmit,
} from "./app-model-providers.ts";

type ModelProviderWizardHost = Parameters<typeof handleModelProviderWizardStart>[0];

function createHost(request: ReturnType<typeof vi.fn>): ModelProviderWizardHost {
  return {
    client: { request },
    connected: true,
    chatModelCatalog: [],
    modelProviderWizardSessionId: null,
    modelProviderWizardStep: null,
    modelProviderWizardInput: null,
    modelProviderWizardBusy: false,
    modelProviderWizardError: null,
    modelProviderWizardMessage: null,
  } as unknown as ModelProviderWizardHost;
}

describe("model provider wizard", () => {
  it("starts for models, advances with the server step id, and cancels the session", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "wizard.start") {
        return {
          sessionId: "wizard-1",
          done: false,
          step: {
            id: "provider",
            type: "select",
            title: "Choose a provider",
            options: [
              { value: "anthropic", label: "Anthropic" },
              { value: "openai", label: "OpenAI" },
            ],
          },
        };
      }
      if (method === "wizard.next") {
        return {
          sessionId: "wizard-1",
          done: false,
          step: {
            id: "credential",
            type: "text",
            message: "Enter the credential",
            sensitive: true,
          },
        };
      }
      if (method === "wizard.cancel") {
        return { done: true, status: "cancelled" };
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const host = createHost(request);

    await handleModelProviderWizardStart(host);

    expect(request).toHaveBeenNthCalledWith(1, "wizard.start", { target: "models" });
    expect(host.modelProviderWizardSessionId).toBe("wizard-1");
    expect(host.modelProviderWizardStep?.id).toBe("provider");
    expect(host.modelProviderWizardInput).toBe("anthropic");

    handleModelProviderWizardInput(host, "openai");
    await handleModelProviderWizardSubmit(host);

    expect(request).toHaveBeenNthCalledWith(2, "wizard.next", {
      sessionId: "wizard-1",
      answer: { stepId: "provider", value: "openai" },
    });
    expect(host.modelProviderWizardStep?.id).toBe("credential");
    expect(host.modelProviderWizardInput).toBe("");

    await handleModelProviderWizardCancel(host);

    expect(request).toHaveBeenNthCalledWith(3, "wizard.cancel", { sessionId: "wizard-1" });
    expect(host.modelProviderWizardSessionId).toBeNull();
    expect(host.modelProviderWizardStep).toBeNull();
  });

  it("starts the custom model target when requested", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "wizard.start") {
        return {
          sessionId: "wizard-custom",
          done: false,
          step: { id: "base-url", type: "text", sensitive: false },
        };
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const host = createHost(request);

    await handleModelProviderWizardStart(host, "custom-model");

    expect(request).toHaveBeenCalledWith("wizard.start", { target: "custom-model" });
    expect(host.modelProviderWizardSessionId).toBe("wizard-custom");
  });
});
