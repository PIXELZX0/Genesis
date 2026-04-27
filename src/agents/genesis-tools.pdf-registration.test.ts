import { describe, expect, it } from "vitest";
import { collectPresentGenesisTools } from "./genesis-tools.registration.js";
import { createPdfTool } from "./tools/pdf-tool.js";

describe("createGenesisTools PDF registration", () => {
  it("includes the pdf tool when the pdf factory returns a tool", () => {
    const pdfTool = createPdfTool({
      agentDir: "/tmp/genesis-agent-main",
      config: {
        agents: {
          defaults: {
            pdfModel: { primary: "openai/gpt-5.4-mini" },
          },
        },
      },
    });

    expect(pdfTool?.name).toBe("pdf");
    expect(collectPresentGenesisTools([pdfTool]).map((tool) => tool.name)).toContain("pdf");
  });
});
