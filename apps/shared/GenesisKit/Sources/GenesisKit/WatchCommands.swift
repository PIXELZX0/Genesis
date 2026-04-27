import Foundation

public enum GenesisWatchCommand: String, Codable, Sendable {
    case status = "watch.status"
    case notify = "watch.notify"
}

public enum GenesisWatchPayloadType: String, Codable, Sendable, Equatable {
    case notify = "watch.notify"
    case reply = "watch.reply"
    case execApprovalPrompt = "watch.execApproval.prompt"
    case execApprovalResolve = "watch.execApproval.resolve"
    case execApprovalResolved = "watch.execApproval.resolved"
    case execApprovalExpired = "watch.execApproval.expired"
    case execApprovalSnapshot = "watch.execApproval.snapshot"
    case execApprovalSnapshotRequest = "watch.execApproval.snapshotRequest"
}

public enum GenesisWatchRisk: String, Codable, Sendable, Equatable {
    case low
    case medium
    case high
}

public enum GenesisWatchExecApprovalDecision: String, Codable, Sendable, Equatable {
    case allowOnce = "allow-once"
    case deny
}

public enum GenesisWatchExecApprovalCloseReason: String, Codable, Sendable, Equatable {
    case expired
    case notFound = "not-found"
    case unavailable
    case replaced
    case resolved
}

public struct GenesisWatchAction: Codable, Sendable, Equatable {
    public var id: String
    public var label: String
    public var style: String?

    public init(id: String, label: String, style: String? = nil) {
        self.id = id
        self.label = label
        self.style = style
    }
}

public struct GenesisWatchExecApprovalItem: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var commandText: String
    public var commandPreview: String?
    public var host: String?
    public var nodeId: String?
    public var agentId: String?
    public var expiresAtMs: Int?
    public var allowedDecisions: [GenesisWatchExecApprovalDecision]
    public var risk: GenesisWatchRisk?

    public init(
        id: String,
        commandText: String,
        commandPreview: String? = nil,
        host: String? = nil,
        nodeId: String? = nil,
        agentId: String? = nil,
        expiresAtMs: Int? = nil,
        allowedDecisions: [GenesisWatchExecApprovalDecision] = [],
        risk: GenesisWatchRisk? = nil)
    {
        self.id = id
        self.commandText = commandText
        self.commandPreview = commandPreview
        self.host = host
        self.nodeId = nodeId
        self.agentId = agentId
        self.expiresAtMs = expiresAtMs
        self.allowedDecisions = allowedDecisions
        self.risk = risk
    }
}

public struct GenesisWatchExecApprovalPromptMessage: Codable, Sendable, Equatable {
    public var type: GenesisWatchPayloadType
    public var approval: GenesisWatchExecApprovalItem
    public var sentAtMs: Int?
    public var deliveryId: String?
    public var resetResolvingState: Bool?

    public init(
        approval: GenesisWatchExecApprovalItem,
        sentAtMs: Int? = nil,
        deliveryId: String? = nil,
        resetResolvingState: Bool? = nil)
    {
        self.type = .execApprovalPrompt
        self.approval = approval
        self.sentAtMs = sentAtMs
        self.deliveryId = deliveryId
        self.resetResolvingState = resetResolvingState
    }
}

public struct GenesisWatchExecApprovalResolveMessage: Codable, Sendable, Equatable {
    public var type: GenesisWatchPayloadType
    public var approvalId: String
    public var decision: GenesisWatchExecApprovalDecision
    public var replyId: String
    public var sentAtMs: Int?

    public init(
        approvalId: String,
        decision: GenesisWatchExecApprovalDecision,
        replyId: String,
        sentAtMs: Int? = nil)
    {
        self.type = .execApprovalResolve
        self.approvalId = approvalId
        self.decision = decision
        self.replyId = replyId
        self.sentAtMs = sentAtMs
    }
}

public struct GenesisWatchExecApprovalResolvedMessage: Codable, Sendable, Equatable {
    public var type: GenesisWatchPayloadType
    public var approvalId: String
    public var decision: GenesisWatchExecApprovalDecision?
    public var resolvedAtMs: Int?
    public var source: String?

    public init(
        approvalId: String,
        decision: GenesisWatchExecApprovalDecision? = nil,
        resolvedAtMs: Int? = nil,
        source: String? = nil)
    {
        self.type = .execApprovalResolved
        self.approvalId = approvalId
        self.decision = decision
        self.resolvedAtMs = resolvedAtMs
        self.source = source
    }
}

public struct GenesisWatchExecApprovalExpiredMessage: Codable, Sendable, Equatable {
    public var type: GenesisWatchPayloadType
    public var approvalId: String
    public var reason: GenesisWatchExecApprovalCloseReason
    public var expiredAtMs: Int?

    public init(
        approvalId: String,
        reason: GenesisWatchExecApprovalCloseReason,
        expiredAtMs: Int? = nil)
    {
        self.type = .execApprovalExpired
        self.approvalId = approvalId
        self.reason = reason
        self.expiredAtMs = expiredAtMs
    }
}

public struct GenesisWatchExecApprovalSnapshotMessage: Codable, Sendable, Equatable {
    public var type: GenesisWatchPayloadType
    public var approvals: [GenesisWatchExecApprovalItem]
    public var sentAtMs: Int?
    public var snapshotId: String?

    public init(
        approvals: [GenesisWatchExecApprovalItem],
        sentAtMs: Int? = nil,
        snapshotId: String? = nil)
    {
        self.type = .execApprovalSnapshot
        self.approvals = approvals
        self.sentAtMs = sentAtMs
        self.snapshotId = snapshotId
    }
}

public struct GenesisWatchExecApprovalSnapshotRequestMessage: Codable, Sendable, Equatable {
    public var type: GenesisWatchPayloadType
    public var requestId: String
    public var sentAtMs: Int?

    public init(requestId: String, sentAtMs: Int? = nil) {
        self.type = .execApprovalSnapshotRequest
        self.requestId = requestId
        self.sentAtMs = sentAtMs
    }
}

public struct GenesisWatchStatusPayload: Codable, Sendable, Equatable {
    public var supported: Bool
    public var paired: Bool
    public var appInstalled: Bool
    public var reachable: Bool
    public var activationState: String

    public init(
        supported: Bool,
        paired: Bool,
        appInstalled: Bool,
        reachable: Bool,
        activationState: String)
    {
        self.supported = supported
        self.paired = paired
        self.appInstalled = appInstalled
        self.reachable = reachable
        self.activationState = activationState
    }
}

public struct GenesisWatchNotifyParams: Codable, Sendable, Equatable {
    public var title: String
    public var body: String
    public var priority: GenesisNotificationPriority?
    public var promptId: String?
    public var sessionKey: String?
    public var kind: String?
    public var details: String?
    public var expiresAtMs: Int?
    public var risk: GenesisWatchRisk?
    public var actions: [GenesisWatchAction]?

    public init(
        title: String,
        body: String,
        priority: GenesisNotificationPriority? = nil,
        promptId: String? = nil,
        sessionKey: String? = nil,
        kind: String? = nil,
        details: String? = nil,
        expiresAtMs: Int? = nil,
        risk: GenesisWatchRisk? = nil,
        actions: [GenesisWatchAction]? = nil)
    {
        self.title = title
        self.body = body
        self.priority = priority
        self.promptId = promptId
        self.sessionKey = sessionKey
        self.kind = kind
        self.details = details
        self.expiresAtMs = expiresAtMs
        self.risk = risk
        self.actions = actions
    }
}

public struct GenesisWatchNotifyPayload: Codable, Sendable, Equatable {
    public var deliveredImmediately: Bool
    public var queuedForDelivery: Bool
    public var transport: String

    public init(deliveredImmediately: Bool, queuedForDelivery: Bool, transport: String) {
        self.deliveredImmediately = deliveredImmediately
        self.queuedForDelivery = queuedForDelivery
        self.transport = transport
    }
}
