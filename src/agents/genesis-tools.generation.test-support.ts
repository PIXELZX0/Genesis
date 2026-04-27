import { describe, expect, it } from "vitest";
import { collectPresentGenesisTools } from "./genesis-tools.registration.js";
import { textResult, type AnyAgentTool } from "./tools/common.js";

function stubAgentTool(name: string): AnyAgentTool {
  return {
    label: name,
    name,
    description: `${name} stub`,
    parameters: { type: "object", properties: {} },
    async execute() {
      return textResult("ok", {});
    },
  };
}

export function describeGenesisGenerationToolRegistration(params: {
  suiteName: string;
  toolName: string;
  toolLabel: string;
}) {
  describe(params.suiteName, () => {
    it(`registers ${params.toolName} when ${params.toolLabel} is present`, () => {
      const tool = stubAgentTool(params.toolName);

      expect(collectPresentGenesisTools([tool])).toEqual([tool]);
    });

    it(`omits ${params.toolName} when ${params.toolLabel} is absent`, () => {
      expect(collectPresentGenesisTools([null]).map((tool) => tool.name)).not.toContain(
        params.toolName,
      );
    });
  });
}
