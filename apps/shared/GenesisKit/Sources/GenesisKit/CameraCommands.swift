import Foundation

public enum GenesisCameraCommand: String, Codable, Sendable {
    case list = "camera.list"
    case snap = "camera.snap"
    case clip = "camera.clip"
}

public enum GenesisCameraFacing: String, Codable, Sendable {
    case back
    case front
}

public enum GenesisCameraImageFormat: String, Codable, Sendable {
    case jpg
    case jpeg
}

public enum GenesisCameraVideoFormat: String, Codable, Sendable {
    case mp4
}

public struct GenesisCameraSnapParams: Codable, Sendable, Equatable {
    public var facing: GenesisCameraFacing?
    public var maxWidth: Int?
    public var quality: Double?
    public var format: GenesisCameraImageFormat?
    public var deviceId: String?
    public var delayMs: Int?

    public init(
        facing: GenesisCameraFacing? = nil,
        maxWidth: Int? = nil,
        quality: Double? = nil,
        format: GenesisCameraImageFormat? = nil,
        deviceId: String? = nil,
        delayMs: Int? = nil)
    {
        self.facing = facing
        self.maxWidth = maxWidth
        self.quality = quality
        self.format = format
        self.deviceId = deviceId
        self.delayMs = delayMs
    }
}

public struct GenesisCameraClipParams: Codable, Sendable, Equatable {
    public var facing: GenesisCameraFacing?
    public var durationMs: Int?
    public var includeAudio: Bool?
    public var format: GenesisCameraVideoFormat?
    public var deviceId: String?

    public init(
        facing: GenesisCameraFacing? = nil,
        durationMs: Int? = nil,
        includeAudio: Bool? = nil,
        format: GenesisCameraVideoFormat? = nil,
        deviceId: String? = nil)
    {
        self.facing = facing
        self.durationMs = durationMs
        self.includeAudio = includeAudio
        self.format = format
        self.deviceId = deviceId
    }
}
