import CoreLocation
import Foundation
import GenesisKit
import UIKit

typealias GenesisCameraSnapResult = (format: String, base64: String, width: Int, height: Int)
typealias GenesisCameraClipResult = (format: String, base64: String, durationMs: Int, hasAudio: Bool)

protocol CameraServicing: Sendable {
    func listDevices() async -> [CameraController.CameraDeviceInfo]
    func snap(params: GenesisCameraSnapParams) async throws -> GenesisCameraSnapResult
    func clip(params: GenesisCameraClipParams) async throws -> GenesisCameraClipResult
}

protocol ScreenRecordingServicing: Sendable {
    func record(
        screenIndex: Int?,
        durationMs: Int?,
        fps: Double?,
        includeAudio: Bool?,
        outPath: String?) async throws -> String
}

@MainActor
protocol LocationServicing: Sendable {
    func authorizationStatus() -> CLAuthorizationStatus
    func accuracyAuthorization() -> CLAccuracyAuthorization
    func ensureAuthorization(mode: GenesisLocationMode) async -> CLAuthorizationStatus
    func currentLocation(
        params: GenesisLocationGetParams,
        desiredAccuracy: GenesisLocationAccuracy,
        maxAgeMs: Int?,
        timeoutMs: Int?) async throws -> CLLocation
    func startLocationUpdates(
        desiredAccuracy: GenesisLocationAccuracy,
        significantChangesOnly: Bool) -> AsyncStream<CLLocation>
    func stopLocationUpdates()
    func startMonitoringSignificantLocationChanges(onUpdate: @escaping @Sendable (CLLocation) -> Void)
    func stopMonitoringSignificantLocationChanges()
}

@MainActor
protocol DeviceStatusServicing: Sendable {
    func status() async throws -> GenesisDeviceStatusPayload
    func info() -> GenesisDeviceInfoPayload
}

protocol PhotosServicing: Sendable {
    func latest(params: GenesisPhotosLatestParams) async throws -> GenesisPhotosLatestPayload
}

protocol ContactsServicing: Sendable {
    func search(params: GenesisContactsSearchParams) async throws -> GenesisContactsSearchPayload
    func add(params: GenesisContactsAddParams) async throws -> GenesisContactsAddPayload
}

protocol CalendarServicing: Sendable {
    func events(params: GenesisCalendarEventsParams) async throws -> GenesisCalendarEventsPayload
    func add(params: GenesisCalendarAddParams) async throws -> GenesisCalendarAddPayload
}

protocol RemindersServicing: Sendable {
    func list(params: GenesisRemindersListParams) async throws -> GenesisRemindersListPayload
    func add(params: GenesisRemindersAddParams) async throws -> GenesisRemindersAddPayload
}

protocol MotionServicing: Sendable {
    func activities(params: GenesisMotionActivityParams) async throws -> GenesisMotionActivityPayload
    func pedometer(params: GenesisPedometerParams) async throws -> GenesisPedometerPayload
}

struct WatchMessagingStatus: Sendable, Equatable {
    var supported: Bool
    var paired: Bool
    var appInstalled: Bool
    var reachable: Bool
    var activationState: String
}

struct WatchQuickReplyEvent: Sendable, Equatable {
    var replyId: String
    var promptId: String
    var actionId: String
    var actionLabel: String?
    var sessionKey: String?
    var note: String?
    var sentAtMs: Int?
    var transport: String
}

struct WatchExecApprovalResolveEvent: Sendable, Equatable {
    var replyId: String
    var approvalId: String
    var decision: GenesisWatchExecApprovalDecision
    var sentAtMs: Int?
    var transport: String
}

struct WatchExecApprovalSnapshotRequestEvent: Sendable, Equatable {
    var requestId: String
    var sentAtMs: Int?
    var transport: String
}

struct WatchNotificationSendResult: Sendable, Equatable {
    var deliveredImmediately: Bool
    var queuedForDelivery: Bool
    var transport: String
}

protocol WatchMessagingServicing: AnyObject, Sendable {
    func status() async -> WatchMessagingStatus
    func setStatusHandler(_ handler: (@Sendable (WatchMessagingStatus) -> Void)?)
    func setReplyHandler(_ handler: (@Sendable (WatchQuickReplyEvent) -> Void)?)
    func setExecApprovalResolveHandler(_ handler: (@Sendable (WatchExecApprovalResolveEvent) -> Void)?)
    func setExecApprovalSnapshotRequestHandler(
        _ handler: (@Sendable (WatchExecApprovalSnapshotRequestEvent) -> Void)?)
    func sendNotification(
        id: String,
        params: GenesisWatchNotifyParams) async throws -> WatchNotificationSendResult
    func sendExecApprovalPrompt(
        _ message: GenesisWatchExecApprovalPromptMessage) async throws -> WatchNotificationSendResult
    func sendExecApprovalResolved(
        _ message: GenesisWatchExecApprovalResolvedMessage) async throws -> WatchNotificationSendResult
    func sendExecApprovalExpired(
        _ message: GenesisWatchExecApprovalExpiredMessage) async throws -> WatchNotificationSendResult
    func syncExecApprovalSnapshot(
        _ message: GenesisWatchExecApprovalSnapshotMessage) async throws -> WatchNotificationSendResult
}

extension CameraController: CameraServicing {}
extension ScreenRecordService: ScreenRecordingServicing {}
extension LocationService: LocationServicing {}
