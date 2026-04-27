import Foundation

public enum GenesisDeviceCommand: String, Codable, Sendable {
    case status = "device.status"
    case info = "device.info"
}

public enum GenesisBatteryState: String, Codable, Sendable {
    case unknown
    case unplugged
    case charging
    case full
}

public enum GenesisThermalState: String, Codable, Sendable {
    case nominal
    case fair
    case serious
    case critical
}

public enum GenesisNetworkPathStatus: String, Codable, Sendable {
    case satisfied
    case unsatisfied
    case requiresConnection
}

public enum GenesisNetworkInterfaceType: String, Codable, Sendable {
    case wifi
    case cellular
    case wired
    case other
}

public struct GenesisBatteryStatusPayload: Codable, Sendable, Equatable {
    public var level: Double?
    public var state: GenesisBatteryState
    public var lowPowerModeEnabled: Bool

    public init(level: Double?, state: GenesisBatteryState, lowPowerModeEnabled: Bool) {
        self.level = level
        self.state = state
        self.lowPowerModeEnabled = lowPowerModeEnabled
    }
}

public struct GenesisThermalStatusPayload: Codable, Sendable, Equatable {
    public var state: GenesisThermalState

    public init(state: GenesisThermalState) {
        self.state = state
    }
}

public struct GenesisStorageStatusPayload: Codable, Sendable, Equatable {
    public var totalBytes: Int64
    public var freeBytes: Int64
    public var usedBytes: Int64

    public init(totalBytes: Int64, freeBytes: Int64, usedBytes: Int64) {
        self.totalBytes = totalBytes
        self.freeBytes = freeBytes
        self.usedBytes = usedBytes
    }
}

public struct GenesisNetworkStatusPayload: Codable, Sendable, Equatable {
    public var status: GenesisNetworkPathStatus
    public var isExpensive: Bool
    public var isConstrained: Bool
    public var interfaces: [GenesisNetworkInterfaceType]

    public init(
        status: GenesisNetworkPathStatus,
        isExpensive: Bool,
        isConstrained: Bool,
        interfaces: [GenesisNetworkInterfaceType])
    {
        self.status = status
        self.isExpensive = isExpensive
        self.isConstrained = isConstrained
        self.interfaces = interfaces
    }
}

public struct GenesisDeviceStatusPayload: Codable, Sendable, Equatable {
    public var battery: GenesisBatteryStatusPayload
    public var thermal: GenesisThermalStatusPayload
    public var storage: GenesisStorageStatusPayload
    public var network: GenesisNetworkStatusPayload
    public var uptimeSeconds: Double

    public init(
        battery: GenesisBatteryStatusPayload,
        thermal: GenesisThermalStatusPayload,
        storage: GenesisStorageStatusPayload,
        network: GenesisNetworkStatusPayload,
        uptimeSeconds: Double)
    {
        self.battery = battery
        self.thermal = thermal
        self.storage = storage
        self.network = network
        self.uptimeSeconds = uptimeSeconds
    }
}

public struct GenesisDeviceInfoPayload: Codable, Sendable, Equatable {
    public var deviceName: String
    public var modelIdentifier: String
    public var systemName: String
    public var systemVersion: String
    public var appVersion: String
    public var appBuild: String
    public var locale: String

    public init(
        deviceName: String,
        modelIdentifier: String,
        systemName: String,
        systemVersion: String,
        appVersion: String,
        appBuild: String,
        locale: String)
    {
        self.deviceName = deviceName
        self.modelIdentifier = modelIdentifier
        self.systemName = systemName
        self.systemVersion = systemVersion
        self.appVersion = appVersion
        self.appBuild = appBuild
        self.locale = locale
    }
}
