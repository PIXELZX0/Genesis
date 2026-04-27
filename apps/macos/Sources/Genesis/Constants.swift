import Foundation

// Stable identifier used for both the macOS LaunchAgent label and Nix-managed defaults suite.
// nix-genesis writes app defaults into this suite to survive app bundle identifier churn.
let launchdLabel = "ai.genesis.mac"
let gatewayLaunchdLabel = "ai.genesis.gateway"
let onboardingVersionKey = "genesis.onboardingVersion"
let onboardingSeenKey = "genesis.onboardingSeen"
let currentOnboardingVersion = 7
let pauseDefaultsKey = "genesis.pauseEnabled"
let iconAnimationsEnabledKey = "genesis.iconAnimationsEnabled"
let swabbleEnabledKey = "genesis.swabbleEnabled"
let swabbleTriggersKey = "genesis.swabbleTriggers"
let voiceWakeTriggerChimeKey = "genesis.voiceWakeTriggerChime"
let voiceWakeSendChimeKey = "genesis.voiceWakeSendChime"
let showDockIconKey = "genesis.showDockIcon"
let defaultVoiceWakeTriggers = ["genesis"]
let voiceWakeMaxWords = 32
let voiceWakeMaxWordLength = 64
let voiceWakeMicKey = "genesis.voiceWakeMicID"
let voiceWakeMicNameKey = "genesis.voiceWakeMicName"
let voiceWakeLocaleKey = "genesis.voiceWakeLocaleID"
let voiceWakeAdditionalLocalesKey = "genesis.voiceWakeAdditionalLocaleIDs"
let voicePushToTalkEnabledKey = "genesis.voicePushToTalkEnabled"
let voiceWakeTriggersTalkModeKey = "genesis.voiceWakeTriggersTalkMode"
let talkEnabledKey = "genesis.talkEnabled"
let iconOverrideKey = "genesis.iconOverride"
let connectionModeKey = "genesis.connectionMode"
let remoteTargetKey = "genesis.remoteTarget"
let remoteIdentityKey = "genesis.remoteIdentity"
let remoteProjectRootKey = "genesis.remoteProjectRoot"
let remoteCliPathKey = "genesis.remoteCliPath"
let canvasEnabledKey = "genesis.canvasEnabled"
let cameraEnabledKey = "genesis.cameraEnabled"
let systemRunPolicyKey = "genesis.systemRunPolicy"
let systemRunAllowlistKey = "genesis.systemRunAllowlist"
let systemRunEnabledKey = "genesis.systemRunEnabled"
let locationModeKey = "genesis.locationMode"
let locationPreciseKey = "genesis.locationPreciseEnabled"
let peekabooBridgeEnabledKey = "genesis.peekabooBridgeEnabled"
let deepLinkKeyKey = "genesis.deepLinkKey"
let modelCatalogPathKey = "genesis.modelCatalogPath"
let modelCatalogReloadKey = "genesis.modelCatalogReload"
let cliInstallPromptedVersionKey = "genesis.cliInstallPromptedVersion"
let heartbeatsEnabledKey = "genesis.heartbeatsEnabled"
let debugPaneEnabledKey = "genesis.debugPaneEnabled"
let debugFileLogEnabledKey = "genesis.debug.fileLogEnabled"
let appLogLevelKey = "genesis.debug.appLogLevel"
let voiceWakeSupported: Bool = ProcessInfo.processInfo.operatingSystemVersion.majorVersion >= 26
