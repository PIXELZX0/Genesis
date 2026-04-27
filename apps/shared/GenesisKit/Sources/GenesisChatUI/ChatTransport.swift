import Foundation

public enum GenesisChatTransportEvent: Sendable {
    case health(ok: Bool)
    case tick
    case chat(GenesisChatEventPayload)
    case agent(GenesisAgentEventPayload)
    case seqGap
}

public protocol GenesisChatTransport: Sendable {
    func requestHistory(sessionKey: String) async throws -> GenesisChatHistoryPayload
    func listModels() async throws -> [GenesisChatModelChoice]
    func sendMessage(
        sessionKey: String,
        message: String,
        thinking: String,
        idempotencyKey: String,
        attachments: [GenesisChatAttachmentPayload]) async throws -> GenesisChatSendResponse

    func abortRun(sessionKey: String, runId: String) async throws
    func listSessions(limit: Int?) async throws -> GenesisChatSessionsListResponse
    func setSessionModel(sessionKey: String, model: String?) async throws
    func setSessionThinking(sessionKey: String, thinkingLevel: String) async throws

    func requestHealth(timeoutMs: Int) async throws -> Bool
    func events() -> AsyncStream<GenesisChatTransportEvent>

    func setActiveSessionKey(_ sessionKey: String) async throws
    func resetSession(sessionKey: String) async throws
    func compactSession(sessionKey: String) async throws
}

extension GenesisChatTransport {
    public func setActiveSessionKey(_: String) async throws {}

    public func resetSession(sessionKey _: String) async throws {
        throw NSError(
            domain: "GenesisChatTransport",
            code: 0,
            userInfo: [NSLocalizedDescriptionKey: "sessions.reset not supported by this transport"])
    }

    public func compactSession(sessionKey _: String) async throws {
        throw NSError(
            domain: "GenesisChatTransport",
            code: 0,
            userInfo: [NSLocalizedDescriptionKey: "sessions.compact not supported by this transport"])
    }

    public func abortRun(sessionKey _: String, runId _: String) async throws {
        throw NSError(
            domain: "GenesisChatTransport",
            code: 0,
            userInfo: [NSLocalizedDescriptionKey: "chat.abort not supported by this transport"])
    }

    public func listSessions(limit _: Int?) async throws -> GenesisChatSessionsListResponse {
        throw NSError(
            domain: "GenesisChatTransport",
            code: 0,
            userInfo: [NSLocalizedDescriptionKey: "sessions.list not supported by this transport"])
    }

    public func listModels() async throws -> [GenesisChatModelChoice] {
        throw NSError(
            domain: "GenesisChatTransport",
            code: 0,
            userInfo: [NSLocalizedDescriptionKey: "models.list not supported by this transport"])
    }

    public func setSessionModel(sessionKey _: String, model _: String?) async throws {
        throw NSError(
            domain: "GenesisChatTransport",
            code: 0,
            userInfo: [NSLocalizedDescriptionKey: "sessions.patch(model) not supported by this transport"])
    }

    public func setSessionThinking(sessionKey _: String, thinkingLevel _: String) async throws {
        throw NSError(
            domain: "GenesisChatTransport",
            code: 0,
            userInfo: [NSLocalizedDescriptionKey: "sessions.patch(thinkingLevel) not supported by this transport"])
    }
}
