import Foundation
import Testing
@testable import Genesis

struct GatewayLaunchAgentManagerTests {
    @Test func `launch agent plist snapshot parses args and env`() throws {
        let url = FileManager().temporaryDirectory
            .appendingPathComponent("genesis-launchd-\(UUID().uuidString).plist")
        let plist: [String: Any] = [
            "ProgramArguments": ["genesis", "gateway", "--port", "18789", "--bind", "loopback"],
            "EnvironmentVariables": [
                "GENESIS_GATEWAY_TOKEN": " secret ",
                "GENESIS_GATEWAY_PASSWORD": "pw",
            ],
        ]
        let data = try PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0)
        try data.write(to: url, options: [.atomic])
        defer { try? FileManager().removeItem(at: url) }

        let snapshot = try #require(LaunchAgentPlist.snapshot(url: url))
        #expect(snapshot.port == 18789)
        #expect(snapshot.bind == "loopback")
        #expect(snapshot.token == "secret")
        #expect(snapshot.password == "pw")
    }

    @Test func `launch agent plist snapshot allows missing bind`() throws {
        let url = FileManager().temporaryDirectory
            .appendingPathComponent("genesis-launchd-\(UUID().uuidString).plist")
        let plist: [String: Any] = [
            "ProgramArguments": ["genesis", "gateway", "--port", "18789"],
        ]
        let data = try PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0)
        try data.write(to: url, options: [.atomic])
        defer { try? FileManager().removeItem(at: url) }

        let snapshot = try #require(LaunchAgentPlist.snapshot(url: url))
        #expect(snapshot.port == 18789)
        #expect(snapshot.bind == nil)
    }
}
