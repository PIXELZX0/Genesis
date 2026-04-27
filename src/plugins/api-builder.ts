import type { GenesisConfig } from "../config/types.genesis.js";
import type { PluginRuntime } from "./runtime/types.js";
import type { GenesisPluginApi, PluginLogger } from "./types.js";

export type BuildPluginApiParams = {
  id: string;
  name: string;
  version?: string;
  description?: string;
  source: string;
  rootDir?: string;
  registrationMode: GenesisPluginApi["registrationMode"];
  config: GenesisConfig;
  pluginConfig?: Record<string, unknown>;
  runtime: PluginRuntime;
  logger: PluginLogger;
  resolvePath: (input: string) => string;
  handlers?: Partial<
    Pick<
      GenesisPluginApi,
      | "registerTool"
      | "registerHook"
      | "registerHttpRoute"
      | "registerChannel"
      | "registerGatewayMethod"
      | "registerCli"
      | "registerReload"
      | "registerNodeHostCommand"
      | "registerSecurityAuditCollector"
      | "registerService"
      | "registerGatewayDiscoveryService"
      | "registerCliBackend"
      | "registerTextTransforms"
      | "registerConfigMigration"
      | "registerAutoEnableProbe"
      | "registerProvider"
      | "registerSpeechProvider"
      | "registerRealtimeTranscriptionProvider"
      | "registerRealtimeVoiceProvider"
      | "registerMediaUnderstandingProvider"
      | "registerImageGenerationProvider"
      | "registerVideoGenerationProvider"
      | "registerMusicGenerationProvider"
      | "registerWebFetchProvider"
      | "registerWebSearchProvider"
      | "registerInteractiveHandler"
      | "onConversationBindingResolved"
      | "registerCommand"
      | "registerContextEngine"
      | "registerCompactionProvider"
      | "registerAgentHarness"
      | "registerCodexAppServerExtensionFactory"
      | "registerAgentToolResultMiddleware"
      | "registerDetachedTaskRuntime"
      | "registerMemoryCapability"
      | "registerMemoryPromptSection"
      | "registerMemoryPromptSupplement"
      | "registerMemoryCorpusSupplement"
      | "registerMemoryFlushPlan"
      | "registerMemoryRuntime"
      | "registerMemoryEmbeddingProvider"
      | "on"
    >
  >;
};

const noopRegisterTool: GenesisPluginApi["registerTool"] = () => {};
const noopRegisterHook: GenesisPluginApi["registerHook"] = () => {};
const noopRegisterHttpRoute: GenesisPluginApi["registerHttpRoute"] = () => {};
const noopRegisterChannel: GenesisPluginApi["registerChannel"] = () => {};
const noopRegisterGatewayMethod: GenesisPluginApi["registerGatewayMethod"] = () => {};
const noopRegisterCli: GenesisPluginApi["registerCli"] = () => {};
const noopRegisterReload: GenesisPluginApi["registerReload"] = () => {};
const noopRegisterNodeHostCommand: GenesisPluginApi["registerNodeHostCommand"] = () => {};
const noopRegisterSecurityAuditCollector: GenesisPluginApi["registerSecurityAuditCollector"] =
  () => {};
const noopRegisterService: GenesisPluginApi["registerService"] = () => {};
const noopRegisterGatewayDiscoveryService: GenesisPluginApi["registerGatewayDiscoveryService"] =
  () => {};
const noopRegisterCliBackend: GenesisPluginApi["registerCliBackend"] = () => {};
const noopRegisterTextTransforms: GenesisPluginApi["registerTextTransforms"] = () => {};
const noopRegisterConfigMigration: GenesisPluginApi["registerConfigMigration"] = () => {};
const noopRegisterAutoEnableProbe: GenesisPluginApi["registerAutoEnableProbe"] = () => {};
const noopRegisterProvider: GenesisPluginApi["registerProvider"] = () => {};
const noopRegisterSpeechProvider: GenesisPluginApi["registerSpeechProvider"] = () => {};
const noopRegisterRealtimeTranscriptionProvider: GenesisPluginApi["registerRealtimeTranscriptionProvider"] =
  () => {};
const noopRegisterRealtimeVoiceProvider: GenesisPluginApi["registerRealtimeVoiceProvider"] =
  () => {};
const noopRegisterMediaUnderstandingProvider: GenesisPluginApi["registerMediaUnderstandingProvider"] =
  () => {};
const noopRegisterImageGenerationProvider: GenesisPluginApi["registerImageGenerationProvider"] =
  () => {};
const noopRegisterVideoGenerationProvider: GenesisPluginApi["registerVideoGenerationProvider"] =
  () => {};
const noopRegisterMusicGenerationProvider: GenesisPluginApi["registerMusicGenerationProvider"] =
  () => {};
const noopRegisterWebFetchProvider: GenesisPluginApi["registerWebFetchProvider"] = () => {};
const noopRegisterWebSearchProvider: GenesisPluginApi["registerWebSearchProvider"] = () => {};
const noopRegisterInteractiveHandler: GenesisPluginApi["registerInteractiveHandler"] = () => {};
const noopOnConversationBindingResolved: GenesisPluginApi["onConversationBindingResolved"] =
  () => {};
const noopRegisterCommand: GenesisPluginApi["registerCommand"] = () => {};
const noopRegisterContextEngine: GenesisPluginApi["registerContextEngine"] = () => {};
const noopRegisterCompactionProvider: GenesisPluginApi["registerCompactionProvider"] = () => {};
const noopRegisterAgentHarness: GenesisPluginApi["registerAgentHarness"] = () => {};
const noopRegisterCodexAppServerExtensionFactory: GenesisPluginApi["registerCodexAppServerExtensionFactory"] =
  () => {};
const noopRegisterAgentToolResultMiddleware: GenesisPluginApi["registerAgentToolResultMiddleware"] =
  () => {};
const noopRegisterDetachedTaskRuntime: GenesisPluginApi["registerDetachedTaskRuntime"] = () => {};
const noopRegisterMemoryCapability: GenesisPluginApi["registerMemoryCapability"] = () => {};
const noopRegisterMemoryPromptSection: GenesisPluginApi["registerMemoryPromptSection"] = () => {};
const noopRegisterMemoryPromptSupplement: GenesisPluginApi["registerMemoryPromptSupplement"] =
  () => {};
const noopRegisterMemoryCorpusSupplement: GenesisPluginApi["registerMemoryCorpusSupplement"] =
  () => {};
const noopRegisterMemoryFlushPlan: GenesisPluginApi["registerMemoryFlushPlan"] = () => {};
const noopRegisterMemoryRuntime: GenesisPluginApi["registerMemoryRuntime"] = () => {};
const noopRegisterMemoryEmbeddingProvider: GenesisPluginApi["registerMemoryEmbeddingProvider"] =
  () => {};
const noopOn: GenesisPluginApi["on"] = () => {};

export function buildPluginApi(params: BuildPluginApiParams): GenesisPluginApi {
  const handlers = params.handlers ?? {};
  return {
    id: params.id,
    name: params.name,
    version: params.version,
    description: params.description,
    source: params.source,
    rootDir: params.rootDir,
    registrationMode: params.registrationMode,
    config: params.config,
    pluginConfig: params.pluginConfig,
    runtime: params.runtime,
    logger: params.logger,
    registerTool: handlers.registerTool ?? noopRegisterTool,
    registerHook: handlers.registerHook ?? noopRegisterHook,
    registerHttpRoute: handlers.registerHttpRoute ?? noopRegisterHttpRoute,
    registerChannel: handlers.registerChannel ?? noopRegisterChannel,
    registerGatewayMethod: handlers.registerGatewayMethod ?? noopRegisterGatewayMethod,
    registerCli: handlers.registerCli ?? noopRegisterCli,
    registerReload: handlers.registerReload ?? noopRegisterReload,
    registerNodeHostCommand: handlers.registerNodeHostCommand ?? noopRegisterNodeHostCommand,
    registerSecurityAuditCollector:
      handlers.registerSecurityAuditCollector ?? noopRegisterSecurityAuditCollector,
    registerService: handlers.registerService ?? noopRegisterService,
    registerGatewayDiscoveryService:
      handlers.registerGatewayDiscoveryService ?? noopRegisterGatewayDiscoveryService,
    registerCliBackend: handlers.registerCliBackend ?? noopRegisterCliBackend,
    registerTextTransforms: handlers.registerTextTransforms ?? noopRegisterTextTransforms,
    registerConfigMigration: handlers.registerConfigMigration ?? noopRegisterConfigMigration,
    registerAutoEnableProbe: handlers.registerAutoEnableProbe ?? noopRegisterAutoEnableProbe,
    registerProvider: handlers.registerProvider ?? noopRegisterProvider,
    registerSpeechProvider: handlers.registerSpeechProvider ?? noopRegisterSpeechProvider,
    registerRealtimeTranscriptionProvider:
      handlers.registerRealtimeTranscriptionProvider ?? noopRegisterRealtimeTranscriptionProvider,
    registerRealtimeVoiceProvider:
      handlers.registerRealtimeVoiceProvider ?? noopRegisterRealtimeVoiceProvider,
    registerMediaUnderstandingProvider:
      handlers.registerMediaUnderstandingProvider ?? noopRegisterMediaUnderstandingProvider,
    registerImageGenerationProvider:
      handlers.registerImageGenerationProvider ?? noopRegisterImageGenerationProvider,
    registerVideoGenerationProvider:
      handlers.registerVideoGenerationProvider ?? noopRegisterVideoGenerationProvider,
    registerMusicGenerationProvider:
      handlers.registerMusicGenerationProvider ?? noopRegisterMusicGenerationProvider,
    registerWebFetchProvider: handlers.registerWebFetchProvider ?? noopRegisterWebFetchProvider,
    registerWebSearchProvider: handlers.registerWebSearchProvider ?? noopRegisterWebSearchProvider,
    registerInteractiveHandler:
      handlers.registerInteractiveHandler ?? noopRegisterInteractiveHandler,
    onConversationBindingResolved:
      handlers.onConversationBindingResolved ?? noopOnConversationBindingResolved,
    registerCommand: handlers.registerCommand ?? noopRegisterCommand,
    registerContextEngine: handlers.registerContextEngine ?? noopRegisterContextEngine,
    registerCompactionProvider:
      handlers.registerCompactionProvider ?? noopRegisterCompactionProvider,
    registerAgentHarness: handlers.registerAgentHarness ?? noopRegisterAgentHarness,
    registerCodexAppServerExtensionFactory:
      handlers.registerCodexAppServerExtensionFactory ?? noopRegisterCodexAppServerExtensionFactory,
    registerAgentToolResultMiddleware:
      handlers.registerAgentToolResultMiddleware ?? noopRegisterAgentToolResultMiddleware,
    registerDetachedTaskRuntime:
      handlers.registerDetachedTaskRuntime ?? noopRegisterDetachedTaskRuntime,
    registerMemoryCapability: handlers.registerMemoryCapability ?? noopRegisterMemoryCapability,
    registerMemoryPromptSection:
      handlers.registerMemoryPromptSection ?? noopRegisterMemoryPromptSection,
    registerMemoryPromptSupplement:
      handlers.registerMemoryPromptSupplement ?? noopRegisterMemoryPromptSupplement,
    registerMemoryCorpusSupplement:
      handlers.registerMemoryCorpusSupplement ?? noopRegisterMemoryCorpusSupplement,
    registerMemoryFlushPlan: handlers.registerMemoryFlushPlan ?? noopRegisterMemoryFlushPlan,
    registerMemoryRuntime: handlers.registerMemoryRuntime ?? noopRegisterMemoryRuntime,
    registerMemoryEmbeddingProvider:
      handlers.registerMemoryEmbeddingProvider ?? noopRegisterMemoryEmbeddingProvider,
    resolvePath: params.resolvePath,
    on: handlers.on ?? noopOn,
  };
}
