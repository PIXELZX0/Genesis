import { definePluginEntry, type AnyAgentTool, type GenesisPluginApi } from "./api.js";
import { createLlmTaskTool } from "./src/llm-task-tool.js";

export default definePluginEntry({
  id: "llm-task",
  name: "LLM Task",
  description: "Optional tool for structured subtask execution",
  register(api: GenesisPluginApi) {
    api.registerTool(createLlmTaskTool(api) as unknown as AnyAgentTool, { optional: true });
  },
});
