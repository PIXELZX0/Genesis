import Foundation
import GenesisKit

extension NodeAppModel {
    static func normalizeWatchNotifyParams(_ params: GenesisWatchNotifyParams) -> GenesisWatchNotifyParams {
        var normalized = params
        normalized.title = params.title.trimmingCharacters(in: .whitespacesAndNewlines)
        normalized.body = params.body.trimmingCharacters(in: .whitespacesAndNewlines)
        normalized.promptId = self.trimmedOrNil(params.promptId)
        normalized.sessionKey = self.trimmedOrNil(params.sessionKey)
        normalized.kind = self.trimmedOrNil(params.kind)
        normalized.details = self.trimmedOrNil(params.details)
        normalized.priority = self.normalizedWatchPriority(params.priority, risk: params.risk)
        normalized.risk = self.normalizedWatchRisk(params.risk, priority: normalized.priority)

        let normalizedActions = self.normalizeWatchActions(
            params.actions,
            kind: normalized.kind,
            promptId: normalized.promptId)
        normalized.actions = normalizedActions.isEmpty ? nil : normalizedActions
        return normalized
    }

    static func normalizeWatchActions(
        _ actions: [GenesisWatchAction]?,
        kind: String?,
        promptId: String?) -> [GenesisWatchAction]
    {
        let provided = (actions ?? []).compactMap { action -> GenesisWatchAction? in
            let id = action.id.trimmingCharacters(in: .whitespacesAndNewlines)
            let label = action.label.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !id.isEmpty, !label.isEmpty else { return nil }
            return GenesisWatchAction(
                id: id,
                label: label,
                style: self.trimmedOrNil(action.style))
        }
        if !provided.isEmpty {
            return Array(provided.prefix(4))
        }

        // Only auto-insert quick actions when this is a prompt/decision flow.
        guard promptId?.isEmpty == false else {
            return []
        }

        let normalizedKind = kind?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
        if normalizedKind.contains("approval") || normalizedKind.contains("approve") {
            return [
                GenesisWatchAction(id: "approve", label: "Approve"),
                GenesisWatchAction(id: "decline", label: "Decline", style: "destructive"),
                GenesisWatchAction(id: "open_phone", label: "Open iPhone"),
                GenesisWatchAction(id: "escalate", label: "Escalate"),
            ]
        }

        return [
            GenesisWatchAction(id: "done", label: "Done"),
            GenesisWatchAction(id: "snooze_10m", label: "Snooze 10m"),
            GenesisWatchAction(id: "open_phone", label: "Open iPhone"),
            GenesisWatchAction(id: "escalate", label: "Escalate"),
        ]
    }

    static func normalizedWatchRisk(
        _ risk: GenesisWatchRisk?,
        priority: GenesisNotificationPriority?) -> GenesisWatchRisk?
    {
        if let risk { return risk }
        switch priority {
        case .passive:
            return .low
        case .active:
            return .medium
        case .timeSensitive:
            return .high
        case nil:
            return nil
        }
    }

    static func normalizedWatchPriority(
        _ priority: GenesisNotificationPriority?,
        risk: GenesisWatchRisk?) -> GenesisNotificationPriority?
    {
        if let priority { return priority }
        switch risk {
        case .low:
            return .passive
        case .medium:
            return .active
        case .high:
            return .timeSensitive
        case nil:
            return nil
        }
    }

    static func trimmedOrNil(_ value: String?) -> String? {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }
}
