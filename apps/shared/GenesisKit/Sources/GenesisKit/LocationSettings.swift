import Foundation

public enum GenesisLocationMode: String, Codable, Sendable, CaseIterable {
    case off
    case whileUsing
    case always
}
